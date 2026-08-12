import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  jsonSchema,
  tool,
  toUIMessageStream,
  UIMessage,
} from "ai";
import { searchWithPageContent } from "@/app/api/search/route";
import {
  getSupportedAttachmentMimeType,
  isImageMimeType,
  isTextMimeType,
  normalizeAttachmentForModel,
} from "@/lib/attachments";
import {
  createProviderClients,
  getFileAnalysisProviderPreference,
  getServerEnvValue,
  MODELS,
  MODEL_MAX_RETRIES,
  runSubcallWithFallback,
  streamTextWithFallback,
  type ProviderClients,
} from "@/lib/llm-providers";
import { readData, STORAGE_KEYS } from "@/lib/server-storage";
import { hasRedeemedCode, PaidCode } from "@/lib/paid-codes";
import { enforceFreeTierLimit } from "@/lib/free-tier";

export const maxDuration = 300;
// Sub-calls (search query generation, file extraction) run
// before the main response stream and have no client-side watchdog once
// progress parts are sent, so bound their internal retries to avoid very long
// server hangs.
const SUBCALL_MAX_RETRIES = 3;
const INITIAL_CHAT_PROMPT = `DO NOT OVER THINK THIS.`;
const APPLY_INITIAL_PROMPT_TO_EVERY_MESSAGE = true;
// User-selectable native reasoning levels for DeepThink. The endpoints
// advertise effort tiers up to "xhigh"; the UI offers low/medium/high/xhigh.
const REASONING_LEVELS = ["low", "medium", "high", "xhigh"] as const;
type ReasoningLevel = (typeof REASONING_LEVELS)[number];
const DEFAULT_REASONING_LEVEL: ReasoningLevel = "medium";
// The models on these endpoints reason BY DEFAULT even when no reasoning
// parameter is sent, so "none" must be sent explicitly to disable it. Used
// for web-search query generation, file analysis, and chat when Deep Think
// is off — none of them may ever carry hidden reasoning effort.
const NO_REASONING = "none" as const;

const FILTER_PHRASES = [
  "This response is AI-generated, for reference only.",
];

function filterResponseText(text: string): string {
  let filtered = text;
  for (const phrase of FILTER_PHRASES) {
    filtered = filtered.replaceAll(phrase, '');
  }
  return filtered;
}

function readSystemPrompt(): string {
  const candidatePaths = [
    path.join(process.cwd(), "systemprompt.txt"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../systemprompt.txt"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../systemprompt.txt"),
  ];

  for (const filePath of candidatePaths) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8").trim();
      }
    } catch {
      //contiune tryin
    }
  }

  return "";
}

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      return m.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ");
    }
  }
  return "";
}

function lastUserMessageId(messages: UIMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") return m.id;
  }
  return undefined;
}

function isChatStart(messages: UIMessage[]): boolean {
  const userCount = messages.filter((message) => message.role === "user").length;
  const assistantCount = messages.filter((message) => message.role === "assistant").length;
  return userCount === 1 && assistantCount === 0;
}








type GlobalSettings = {
  BLOCKRUN_API_KEY?: string;
  FALLBACK_API_KEY?: string;
  SERPER_API_KEY?: string;
  BASED_URL?: string;
  FALLBACK_BASED_URL?: string;
  useFallbackAsPrimary?: boolean;
  PRIMARY_MODELS?: Record<string, string>;
  FALLBACK_MODELS?: Record<string, string>;
};

async function readGlobalSettings(): Promise<GlobalSettings> {
  try {
    return await readData<GlobalSettings>(STORAGE_KEYS.GLOBAL_SETTINGS, {});
  } catch {
    return {};
  }
}

async function readPaidCodeByRedeemedCode(code: string, clientId: string): Promise<PaidCode | null> {
  try {
    const codes = await readData<PaidCode[]>(STORAGE_KEYS.PAID_CODES, []);
    return codes.find((c) => c.code === code && hasRedeemedCode(c, clientId)) || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const {
      messages,
      model: modelKey = "instant",
      deepThink = false,
      reasoningLevel,
      webSearch = false,
      modelSettings,
      paidTierCode,
      paidTierClientId,
      clientId = "",
      chatId = "",
      browserDate,
      browserTime,
    }: {
      messages: UIMessage[];
      model?: string;
      deepThink?: boolean;
      reasoningLevel?: string;
      webSearch?: boolean;
      modelSettings?: {
        temperature?: number;
        topK?: number;
        maxTokens?: number;
      };
      paidTierCode?: string;
      paidTierClientId?: string | null;
      clientId?: string;
      chatId?: string;
      browserDate?: string;
      browserTime?: string;
    } = await req.json();

    const normalizedClientId = clientId || paidTierClientId || "";
    const normalizedChatId = chatId || "default";

    // Read the redeemed paid code once and reuse it for both the access check
    // and the token resolution below.
    const paidCode =
      paidTierCode && paidTierClientId
        ? await readPaidCodeByRedeemedCode(paidTierCode, paidTierClientId)
        : null;

    const hasPaidAccess = Boolean(paidCode);

    // Reasoning is ONLY active when the user explicitly enables Deep Think
    // and picks a level. Deep Think off = explicit "none" (these endpoints
    // think by default otherwise). Deep Think on = the validated level.
    // High and xhigh are restricted to paid users only.
    const isRestrictedLevel = (reasoningLevel === "high" || reasoningLevel === "xhigh");
    const resolvedReasoning: ReasoningLevel | typeof NO_REASONING = deepThink
      ? (REASONING_LEVELS as readonly string[]).includes(reasoningLevel ?? "")
        ? (isRestrictedLevel && !hasPaidAccess
            ? DEFAULT_REASONING_LEVEL
            : (reasoningLevel as ReasoningLevel))
        : DEFAULT_REASONING_LEVEL
      : NO_REASONING;
    console.info(`[chat] reasoning: ${resolvedReasoning}`);

    if (!hasPaidAccess) {
      await enforceFreeTierLimit(normalizedClientId, normalizedChatId, lastUserMessageId(messages));
    }

    const invalidAttachment = messages.some((message) =>
      message.parts.some((part) => {
        if (part.type !== "file") return false;

        const mimeType = getSupportedAttachmentMimeType({
          mimeType:
            (part as { mediaType?: string; mimeType?: string }).mediaType ??
            (part as { mediaType?: string; mimeType?: string }).mimeType,
          filename: (part as { filename?: string }).filename,
        });

        return !mimeType || isImageMimeType(mimeType);
      })
    );

    if (invalidAttachment) {
      return Response.json(
        { error: "Image uploads are not supported." },
        { status: 400 }
      );
    }

    const modelId = MODELS[modelKey] ?? MODELS.instant;
    // The browser supplies its local date and time, avoiding a server-timezone mismatch.
    const browserDateIsValid =
      typeof browserDate === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(browserDate);
    const browserTimeIsValid =
      typeof browserTime === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(browserTime);
    const browserDateTimeContext = browserDateIsValid
      ? browserTimeIsValid
        ? `Current date and time: ${browserDate} ${browserTime}`
        : `Current date: ${browserDate}`
      : "";
    const baseSystemPrompt = [browserDateTimeContext, readSystemPrompt()]
      .filter(Boolean)
      .join("\n\n");

    // Determine which API keys to use:
    // 1. Global settings (admin-controlled) are the runtime baseline for
    //    EVERYONE — endpoints, models, and keys.
    // 2. A redeemed paid tier code overrides API keys only (its dedicated
    //    tokens); it never replaces the endpoint/model configuration.
    // 3. Environment variables are the final fallback for anything unset.
    let apiKey = getServerEnvValue("BLOCKRUN_API_KEY", "BLOCKRUN_TOKEN", "OPENAI_API_KEY");
    let fallbackApiKey = getServerEnvValue("FALLBACK_API_KEY");
    let serperApiKey = getServerEnvValue("SERPER_API_KEY");
    let primaryBaseURL = getServerEnvValue("BASED_URL", "BASE_URL", "BLOCKRUN_BASE_URL", "OPENAI_BASE_URL");
    let fallbackBaseURL = getServerEnvValue("FALLBACK_BASED_URL");
    let useFallbackAsPrimary = false;
    let runtimePrimaryModels: Record<string, string> | undefined;
    let runtimeFallbackModels: Record<string, string> | undefined;

    const globalSettings = await readGlobalSettings();
    if (globalSettings.BLOCKRUN_API_KEY) apiKey = globalSettings.BLOCKRUN_API_KEY;
    if (globalSettings.FALLBACK_API_KEY) fallbackApiKey = globalSettings.FALLBACK_API_KEY;
    if (globalSettings.SERPER_API_KEY) serperApiKey = globalSettings.SERPER_API_KEY;
    if (globalSettings.BASED_URL) primaryBaseURL = globalSettings.BASED_URL;
    if (globalSettings.FALLBACK_BASED_URL) fallbackBaseURL = globalSettings.FALLBACK_BASED_URL;
    useFallbackAsPrimary = Boolean(globalSettings.useFallbackAsPrimary);
    runtimePrimaryModels = globalSettings.PRIMARY_MODELS;
    runtimeFallbackModels = globalSettings.FALLBACK_MODELS;

    if (paidCode?.expiresAt && new Date(paidCode.expiresAt) > new Date()) {
      if (paidCode.tokens.BLOCKRUN_API_KEY) apiKey = paidCode.tokens.BLOCKRUN_API_KEY;
      if (paidCode.tokens.FALLBACK_API_KEY) fallbackApiKey = paidCode.tokens.FALLBACK_API_KEY;
      if (paidCode.tokens.SERPER_API_KEY) serperApiKey = paidCode.tokens.SERPER_API_KEY;
      if (paidCode.tokens.BASED_URL) primaryBaseURL = paidCode.tokens.BASED_URL;
      if (paidCode.tokens.FALLBACK_BASED_URL) fallbackBaseURL = paidCode.tokens.FALLBACK_BASED_URL;
    }

    if (useFallbackAsPrimary) {
      [primaryBaseURL, fallbackBaseURL] = [fallbackBaseURL, primaryBaseURL];
      [apiKey, fallbackApiKey] = [fallbackApiKey, apiKey];
      [runtimePrimaryModels, runtimeFallbackModels] = [runtimeFallbackModels, runtimePrimaryModels];
    }

    const providerClients = createProviderClients(apiKey, {
      primaryBaseURL,
      fallbackBaseURL,
      fallbackApiKey,
    });

    // Normalize any file attachment MIME types before sending them to the model provider so
    // browser-reported variants like text/x-go are converted to a supported type.
    function decodeDataUrlToText(dataUrl: string) {
      const match = dataUrl.match(/^data:[^;]+;base64,(.*)$/);
      if (!match) return dataUrl;
      return Buffer.from(match[1], "base64").toString("utf-8");
    }

    const normalizedMessages = messages.map((message) => ({
      ...message,
      parts: message.parts.flatMap((part) => {
        if (part.type !== "file") {
          return [part];
        }

        const mimeType = getSupportedAttachmentMimeType({
          mimeType:
            (part as { mediaType?: string; mimeType?: string }).mediaType ??
            (part as { mediaType?: string; mimeType?: string }).mimeType,
          filename: (part as { filename?: string }).filename,
        });

        if (mimeType && isTextMimeType(mimeType)) {
          const textContent = decodeDataUrlToText((part as { url: string }).url);
          const filename = (part as { filename?: string }).filename || "attachment";
          return [
            {
              type: "text" as const,
              text: `File: ${filename}\nMime-Type: ${mimeType}\n\n${textContent}`,
            },
          ];
        }

        return [normalizeAttachmentForModel(part as any) as any];
      }),
    }));

    // Convert messages once so they can be reused for search query
    // generation, file analysis and the final response.
    const modelMessages = await convertToModelMessages(normalizedMessages);

    // Diagnostic: confirm the message roles being sent to the model.
    console.info(
      `[chat] history: ${modelMessages.length} message(s) -> ` +
        modelMessages.map((m) => m.role).join(", ")
    );

    const stream = createUIMessageStream({
      onError: (error) => {
        console.error("[chat] stream error", error);
        if (error instanceof Error) {
          return error.message;
        }
        return typeof error === "string" ? error : "An error occurred while processing your request.";
      },
      execute: async ({ writer }) => {
        // --- Per-file sequential scanning (runs FIRST) ---
        // Extract file attachments from the last user message and process each
        // file through a focused sub-agent call, one at a time. This avoids
        // sending all raw file content in one request (which causes "structurally
        // heavy" / long-context errors) and instead injects compact summaries.
        let fileContext = "";
        let responseModelMessages = modelMessages;
        const lastUserMsg = [...normalizedMessages]
          .reverse()
          .find((m) => m.role === "user");
        const fileTextParts =
          lastUserMsg?.parts.filter(
            (p): p is { type: "text"; text: string } =>
              p.type === "text" && p.text.startsWith("File: ")
          ) ?? [];
        const hasFiles = fileTextParts.length > 0;
        if (hasFiles) {
          const userQuestion = lastUserText(messages);
          const extractedContexts: string[] = [];
          const fileCount = fileTextParts.length;
          // NOTE: data parts with the same type+id REPLACE each other in the
          // AI SDK stream, so every event gets a unique id and the client
          // aggregates the full state from the accumulated parts.
          let eventSeq = 0;
          const nextEventId = () => `file-scan-${eventSeq++}`;

          writer.write({
            type: "data-file",
            id: nextEventId(),
            data: { status: "Analyzing files: ", total: fileCount },
          });

          for (let i = 0; i < fileTextParts.length; i++) {
            const text = fileTextParts[i].text;
            const match = text.match(
              /^File: (.+?)\nMime-Type: (.+?)\n\n([\s\S]*)$/
            );
            if (!match) continue;
            const [, filename, mimeType, content] = match;

            const cappedContent =
              content.length > 80_000
                ? content.slice(0, 80_000) +
                  "\n\n[...truncated – content exceeds 80 000 characters]"
                : content;

            writer.write({
              type: "data-file",
              id: nextEventId(),
              data: {
                status: "reading",
                filename,
                mimeType,
                index: i,
                total: fileCount,
              },
            });

            try {
              const extracted = await runSubcallWithFallback(providerClients, {
                modelId: MODELS.fileAnalysis,
                startProvider: getFileAnalysisProviderPreference(),
                system:
                  "You are a file analysis tool. Read the following file and extract only the information that is relevant to the user's question. Be concise but thorough. If the file contains code, describe its structure, key functions, exports, and anything relevant to the question. Do not repeat the entire file — extract only what matters.",
                messages: [
                  {
                    role: "user" as const,
                    content: `File: ${filename} (type: ${mimeType})\n\n${cappedContent}\n\n---\nUser's question: ${userQuestion}\n\nExtract the relevant information from this file.`,
                  },
                ],
                maxRetries: SUBCALL_MAX_RETRIES,
                // File extraction is a utility sub-call — never reason.
                reasoning: NO_REASONING,
                primaryModels: runtimePrimaryModels,
                fallbackModels: runtimeFallbackModels,
              });
              const trimmed = filterResponseText(extracted).trim();
              if (trimmed) {
                extractedContexts.push(`### ${filename}\n\n${trimmed}`);
              }
            } catch (error) {
              console.error(
                `[chat] file extraction failed for ${filename}`,
                error
              );
            }

            writer.write({
              type: "data-file",
              id: nextEventId(),
              data: {
                status: "analyzed",
                filename,
                mimeType,
                index: i,
                total: fileCount,
              },
            });
          }

          writer.write({
            type: "data-file",
            id: nextEventId(),
            data: { status: "done", total: fileCount },
          });

          if (extractedContexts.length > 0) {
            fileContext = extractedContexts.join("\n\n");
            // Replace the full file content in the last user message with a
            // compact reference so the final request is lightweight.
            const lastUserMsgIdx = normalizedMessages.indexOf(lastUserMsg!);
            const strippedParts = lastUserMsg!.parts.map((part) => {
              if (
                part.type === "text" &&
                (part as { text?: string }).text?.startsWith("File: ")
              ) {
                const nameMatch = (part as { text: string }).text.match(
                  /^File: (.+?)\n/
                );
                return {
                  type: "text" as const,
                  text: `[File: ${nameMatch?.[1] ?? "attachment"} — context extracted below]`,
                };
              }
              return part;
            });
            const strippedMessages = [...normalizedMessages];
            strippedMessages[lastUserMsgIdx] = {
              ...lastUserMsg!,
              parts: strippedParts,
            } as any;
            responseModelMessages =
              await convertToModelMessages(strippedMessages);
          }
        }

        // --- Web search (disabled when files are attached) ---
        // Web search runs as a NATIVE tool call: the model decides when to
        // invoke the tool and generates the query itself; the results come
        // back as a tool result. Progress is streamed through data-search
        // parts (kept for the typing-indicator logic), while the tool's own
        // part (tool-webSearch) drives the visible "searching" UI.
        const webSearchTool =
          webSearch && !hasFiles
            ? {
                webSearch: tool({
                  description:
                    `${baseSystemPrompt} Search the live web for up-to-date, factual, or outside-knowledge information (current events, prices, stats, recent facts). Call this tool before answering whenever the user asks for information that may have changed or is not in your training data. Provide a concise, specific keyword query.`,
                  inputSchema: jsonSchema<{ query: string }>({
                    type: "object",
                    properties: {
                      query: {
                        type: "string",
                        description:
                          "The web search query. 5–10 keywords, not a full sentence.",
                      },
                    },
                    required: ["query"],
                    additionalProperties: false,
                  }),
                  execute: async (input: { query: string }) => {
                    const query = input.query;
                    writer.write({
                      type: "data-search",
                      id: "search",
                      data: { status: "searching", query },
                    });
                    try {
                      const results = query
                        ? await searchWithPageContent(query, serperApiKey)
                        : [];
                      writer.write({
                        type: "data-search",
                        id: "search",
                        data: { status: "done", query, results },
                      });
                      return { results };
                    } catch (error) {
                      console.error("[chat] web search tool failed", error);
                      writer.write({
                        type: "data-search",
                        id: "search",
                        data: { status: "error", query },
                      });
                      return { results: [] };
                    }
                  },
                }),
              }
            : undefined;

        // --- Build final system prompt with structured sections ---
        let finalSystemPrompt = baseSystemPrompt;
        const shouldApplyInitialPrompt = APPLY_INITIAL_PROMPT_TO_EVERY_MESSAGE
          ? true
          : isChatStart(messages);

        if (shouldApplyInitialPrompt) {
          finalSystemPrompt += `\n\n${INITIAL_CHAT_PROMPT}`;
        }
        if (webSearchTool) {
          finalSystemPrompt +=
            `\n\nFor web search: \n\nWeb search is available via the webSearch tool. When you use it, synthesise the returned results into a direct answer and cite sources inline like [1]. Do not mention the tool call itself to the user.`;
        }
        if (fileContext) {
          finalSystemPrompt += `\n\n---FILE CONTEXT---\n\nBelow are focused summaries of the files the user attached. Each file was read and analysed individually to extract only the information relevant to the user's question:\n\n${fileContext}\n\n---END---`;
        }

        // --- Final streaming response (with silent provider fail-over) ---
        // DeepThink now uses the chat model's NATIVE reasoning instead of a
        // separate planner sub-call: we request a higher reasoning effort and
        // surface the model's own thinking text (reasoning_content SSE deltas)
        // through the "thought" progress block. The AI SDK's chat-completions
        // parser discards reasoning_content, so a dedicated client pair tees
        // the raw SSE stream for the final response only.
        const thought = { startedAt: 0, accumulated: "", lastWrite: 0, done: false };
        const responseClients = deepThink
          ? createProviderClients(apiKey, {
              // Must mirror the resolved endpoint/key configuration of
              // providerClients (including the useFallbackAsPrimary swap and
              // global-settings endpoints), or the final answer would hit the
              // raw env endpoints with swapped keys/models.
              primaryBaseURL,
              fallbackBaseURL,
              fallbackApiKey,
              onReasoningDelta: (delta) => {
                if (thought.done) return;
                thought.accumulated += delta;
                const now = Date.now();
                if (now - thought.lastWrite >= 150) {
                  thought.lastWrite = now;
                  writer.write({
                    type: "data-thought",
                    id: "thought",
                    data: { status: "thinking", text: filterResponseText(thought.accumulated) },
                  });
                }
              },
            })
          : providerClients;

        let stream;
        try {
          if (deepThink) {
            thought.startedAt = Date.now();
            writer.write({ type: "data-thought", id: "thought", data: { status: "thinking" } });
          }
          stream = streamTextWithFallback(responseClients, {
            modelId,
            system: finalSystemPrompt,
            messages: responseModelMessages,
            modelSettings,
            // "none" when Deep Think is off (these endpoints think by default
            // otherwise), or the user-selected low/medium/high level.
            reasoning: resolvedReasoning,
            // Native tool calling: the model can invoke webSearch and gets the
            // results fed back to answer. stopWhen lets the SDK loop run the
            // tool result through before producing the final answer.
            tools: webSearchTool,
            stopWhen: webSearchTool
              ? [
                  ({ steps }: { steps: Array<{ toolCalls?: Array<{ toolName: string }> }> }) =>
                    (steps[steps.length - 1]?.toolCalls?.length ?? 0) === 0,
                  ({ steps }: { steps: Array<unknown> }) => steps.length >= 2,
                ]
              : undefined,
            maxRetries: MODEL_MAX_RETRIES,
            primaryModels: runtimePrimaryModels,
            fallbackModels: runtimeFallbackModels,
            onTextDelta: (text) => filterResponseText(text),
            onAttemptStart: () => {
              // A failed attempt is retried on the other endpoint — discard
              // any reasoning text it produced before the switchover.
              thought.accumulated = "";
              thought.lastWrite = 0;
            },
            onFirstText: () => {
              if (!deepThink || thought.done) return;
              thought.done = true;
              const seconds = Math.max(1, Math.round((Date.now() - thought.startedAt) / 1000));
              writer.write({
                type: "data-thought",
                id: "thought",
                data: {
                  status: "done",
                  text: filterResponseText(thought.accumulated),
                  seconds,
                },
              });
            },
            onProviderSwitch: (provider, attempt) => {
              console.warn(
                `[chat] switching to ${provider} endpoint after attempt ${attempt + 1}`
              );
            },
            onAttemptError: (error, attempt) => {
              console.error(
                `[chat] provider attempt ${attempt + 1} failed`,
                error
              );
            },
          });
        } catch (error) {
          console.error("[chat] streamText failed", error);
          const message = error instanceof Error ? error.message : "Unknown provider error";
          throw new Error(`AI request failed: ${message}`);
        }

        writer.merge(
          toUIMessageStream({
            stream,
            sendStart: false,
            sendFinish: false,
            onError: (error) => {
              console.error("[chat] ui stream error", error);
              // Don't leave the thought block stuck in "Thinking…" when the
              // whole response failed.
              if (deepThink && !thought.done) {
                thought.done = true;
                writer.write({
                  type: "data-thought",
                  id: "thought",
                  data: { status: "error" },
                });
              }
              if (error instanceof Error) {
                return error.message;
              }
              return typeof error === "string" ? error : "An error occurred while processing your request.";
            },
          })
        );
      },
    });

    try {
      return createUIMessageStreamResponse({ stream });
    } catch (error) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred.";
      console.error("[chat] stream response failed", error);
      return Response.json({ error: message }, { status: 500 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    console.error("[chat] POST failed", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
