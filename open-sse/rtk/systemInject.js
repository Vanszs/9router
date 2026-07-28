// Shared system-prompt injector: appends an instruction into the system message of
// the final request body, dispatching by format so it works for translated and
// native-passthrough flows. Used by caveman.js and ponytail.js.

import { FORMATS } from "../translator/formats.js";

const SEP = "\n\n";

/**
 * Detect whether a request body already carries a system message/prompt so the
 * chat handler knows when NOT to inject a default. Detects every shape we
 * support across OpenAI/Claude/Gemini/Responses. Returns true when any system
 * slot already has non-empty text.
 */
export function hasSystemPrompt(body, format) {
  if (!body) return false;

  switch (format) {
    case FORMATS.CLAUDE: {
      if (typeof body.system === "string") return body.system.trim().length > 0;
      if (Array.isArray(body.system)) {
        return body.system.some(b => b?.type === "text" && typeof b.text === "string" && b.text.trim().length > 0);
      }
      return false;
    }
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
    case FORMATS.ANTIGRAVITY: {
      const target = body.request && typeof body.request === "object" ? body.request : body;
      const sys = target?.system_instruction ?? target?.systemInstruction;
      if (sys && Array.isArray(sys.parts)) {
        return sys.parts.some(p => typeof p?.text === "string" && p.text.trim().length > 0);
      }
      return false;
    }
    default: {
      // OpenAI Responses API
      if (typeof body.instructions === "string" && body.instructions.trim().length > 0) return true;
      const arr = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : null;
      if (!arr) return false;
      return arr.some(m => m && (m.role === "system" || m.role === "developer") && hasOpenAIMessageContent(m));
    }
  }
}

function hasOpenAIMessageContent(msg) {
  const c = msg?.content;
  if (typeof c === "string") return c.trim().length > 0;
  if (Array.isArray(c)) return c.some(p => (p?.type === "input_text" || p?.type === "text") && typeof p.text === "string" && p.text.trim().length > 0);
  return false;
}

/**
 * Inject the default system prompt ONLY when the request does not already carry
 * one. Honors the same shape dispatch as injectSystemPrompt.
 */
export function injectDefaultSystemPrompt(body, format, prompt) {
  if (!body || !prompt) return;
  if (hasSystemPrompt(body, format)) return;
  injectSystemPrompt(body, format, prompt);
}

export function injectSystemPrompt(body, format, prompt) {
  if (!body || !prompt) return;

  switch (format) {
    case FORMATS.CLAUDE:
      injectClaudeSystem(body, prompt);
      return;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
    case FORMATS.ANTIGRAVITY:
      // Antigravity wraps Gemini shape in body.request → injectGeminiSystem handles it
      injectGeminiSystem(body, prompt);
      return;
    default:
      // OpenAI and OpenAI-shaped formats (responses/codex/cursor/kiro/ollama)
      injectMessagesSystem(body, prompt);
  }
}

// OpenAI-shaped: messages[] (chat) or input[] (responses) or instructions (responses string)
function injectMessagesSystem(body, prompt) {
  // OpenAI Responses API: top-level string field
  if (typeof body.instructions === "string") {
    body.instructions = body.instructions
      ? `${body.instructions}${SEP}${prompt}`
      : prompt;
    return;
  }

  const arr = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!arr) return;

  const idx = arr.findIndex(m => m && (m.role === "system" || m.role === "developer"));
  if (idx >= 0) {
    appendToOpenAIMessage(arr[idx], prompt);
  } else {
    arr.unshift({ role: "system", content: prompt });
  }
}

function appendToOpenAIMessage(msg, prompt) {
  if (typeof msg.content === "string") {
    msg.content = `${msg.content}${SEP}${prompt}`;
  } else if (Array.isArray(msg.content)) {
    // Responses-style array of parts {type:"input_text"|"text", text}
    msg.content.push({ type: "input_text", text: prompt });
  } else {
    msg.content = prompt;
  }
}

// Claude shape: body.system as string | array of {type:"text", text}
// Insert before the last cache_control block to keep injection inside the cached prefix.
function injectClaudeSystem(body, prompt) {
  if (typeof body.system === "string" && body.system.length > 0) {
    body.system = `${body.system}${SEP}${prompt}`;
    return;
  }
  if (Array.isArray(body.system)) {
    const block = { type: "text", text: prompt };
    let lastCacheIdx = -1;
    for (let i = body.system.length - 1; i >= 0; i--) {
      if (body.system[i]?.cache_control) { lastCacheIdx = i; break; }
    }
    if (lastCacheIdx >= 0) {
      body.system.splice(lastCacheIdx, 0, block);
    } else {
      body.system.push(block);
    }
    return;
  }
  body.system = prompt;
}

// Gemini shape: body.system_instruction | body.systemInstruction | body.request.systemInstruction
// Each shape: { parts: [{ text }] }
function injectGeminiSystem(body, prompt) {
  const target = body.request && typeof body.request === "object" ? body.request : body;
  const useSnake = Object.prototype.hasOwnProperty.call(target, "system_instruction");
  const key = useSnake ? "system_instruction" : "systemInstruction";
  const sys = target[key];
  if (sys && Array.isArray(sys.parts)) {
    sys.parts.push({ text: prompt });
    return;
  }
  target[key] = { parts: [{ text: prompt }] };
}
