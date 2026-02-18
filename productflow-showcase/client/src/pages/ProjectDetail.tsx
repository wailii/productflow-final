import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  Command,
  Download,
  History,
  LayoutPanelTop,
  Loader2,
  Paperclip,
  Send,
  Settings2,
} from "lucide-react";
import {
  Fragment,
  type ChangeEventHandler,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { useLocation, useParams } from "wouter";

const STEP_META = [
  { title: "需求预处理与澄清", phase: "需求定向" },
  { title: "原始需求提炼", phase: "需求定向" },
  { title: "需求转功能列表", phase: "需求定向" },
  { title: "功能设计细化", phase: "方案设计" },
  { title: "AI 原型提示词优化", phase: "方案设计" },
  { title: "原型设计", phase: "方案设计" },
  { title: "需求确认与调整", phase: "交付沉淀" },
  { title: "功能性需求文档", phase: "交付沉淀" },
  { title: "补充章节生成", phase: "交付沉淀" },
] as const;

const USER_VISIBLE_ARTIFACT_TYPES = new Set([
  "step_output",
  "final",
]);

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function normalizeMarkdownContent(content: string) {
  const text = String(content ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";

  const fencedMarkdown = text.match(/^```(?:markdown|md|mdx)\s*\n([\s\S]*?)\n```$/i);
  if (fencedMarkdown?.[1]) {
    return fencedMarkdown[1].trim();
  }

  if (text.startsWith("\"") && text.endsWith("\"")) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "string") {
        return parsed.replace(/\r\n?/g, "\n");
      }
    } catch {
      // noop: keep raw text
    }
  }

  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const maybeMarkdown = [
        parsed.text,
        parsed.content,
        parsed.markdown,
        parsed.output,
        parsed.result,
        parsed.answer,
      ]
        .find((value) => typeof value === "string");
      if (typeof maybeMarkdown === "string") {
        return normalizeMarkdownContent(maybeMarkdown);
      }
    } catch {
      // noop: keep raw text
    }
  }

  const escapedNewlineCount = (text.match(/\\n/g) ?? []).length;
  const realNewlineCount = (text.match(/\n/g) ?? []).length;
  if (realNewlineCount === 0 && escapedNewlineCount >= 2) {
    return text
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, "\"");
  }

  return text;
}

function isImageMime(mimeType?: string | null) {
  return Boolean(mimeType && mimeType.toLowerCase().startsWith("image/"));
}

function isPdfMime(mimeType?: string | null) {
  return Boolean(mimeType && mimeType.toLowerCase().includes("pdf"));
}

type PreviewTarget =
  | { kind: "artifact"; id: number }
  | { kind: "upload"; id: number }
  | null;

type AssetHistoryItem =
  | {
      key: string;
      kind: "artifact";
      id: number;
      title: string;
      subtitle: string;
      createdAt: string | Date;
      latestLabel: string;
    }
  | {
      key: string;
      kind: "upload";
      id: number;
      title: string;
      subtitle: string;
      createdAt: string | Date;
      latestLabel: string;
    };

type ParsedStepCommand =
  | {
      type: "jump";
      targetStep: number;
      intent: "forward" | "rewind";
    }
  | {
      type: "confirm_jump";
      targetStep: number;
    }
  | {
      type: "complete";
    };

type CommandNoticeTone = "info" | "warning" | "success";

const STEP_COMMAND_HINTS = [
  "进入下一步",
  "跳到第3步",
  "回到第2步重做",
] as const;

function normalizeCommandText(value: string) {
  return value
    .replace(/[，。！？；、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseStepToken(value: string) {
  const token = value.trim();
  if (/^[1-9]$/.test(token)) {
    return Number(token) - 1;
  }
  const zhMap: Record<string, number> = {
    一: 0,
    二: 1,
    三: 2,
    四: 3,
    五: 4,
    六: 5,
    七: 6,
    八: 7,
    九: 8,
  };
  return zhMap[token] ?? null;
}

function parseStepCommand(
  rawText: string,
  currentStep: number,
  pendingJumpTarget: number | null
): ParsedStepCommand | null {
  const text = normalizeCommandText(rawText);
  if (!text) return null;

  if (pendingJumpTarget !== null) {
    const confirmWithStep = text.match(/确认(?:跳到|进入|前往)?第?\s*([1-9一二三四五六七八九])\s*(?:步|阶段)?/);
    const confirmOnly = /^(确认|可以|ok|yes|继续|好)$/.test(text.toLowerCase());
    if (confirmWithStep && parseStepToken(confirmWithStep[1]) === pendingJumpTarget) {
      return { type: "confirm_jump", targetStep: pendingJumpTarget };
    }
    if (confirmOnly) {
      return { type: "confirm_jump", targetStep: pendingJumpTarget };
    }
  }

  const rewindStep = text.match(/(?:回到|返回|退回|重做|回改|改回)\s*第?\s*([1-9一二三四五六七八九])\s*(?:步|阶段)?/);
  if (rewindStep) {
    const step = parseStepToken(rewindStep[1]);
    if (step === null) return null;
    return {
      type: "jump",
      targetStep: step,
      intent: "rewind",
    };
  }

  const explicitStep = text.match(/(?:跳到|进入|前往|到|去)\s*第?\s*([1-9一二三四五六七八九])\s*(?:步|阶段)?/);
  if (explicitStep) {
    const step = parseStepToken(explicitStep[1]);
    if (step === null) return null;
    return {
      type: "jump",
      targetStep: step,
      intent: "forward",
    };
  }

  const nextStepIntent = /(进入|去|到|继续|推进).{0,4}(下一步|下个步骤|下一阶段)|^(下一步|next)$/i.test(text);
  if (nextStepIntent) {
    if (currentStep >= 8) {
      return {
        type: "complete",
      };
    }
    return {
      type: "jump",
      targetStep: Math.max(0, Math.min(8, currentStep + 1)),
      intent: "forward",
    };
  }

  return null;
}

function extractRewindReason(rawText: string) {
  const normalized = normalizeCommandText(rawText);
  const stripped = normalized
    .replace(/(?:回到|返回|退回|重做|回改|改回)\s*第?\s*[1-9一二三四五六七八九]\s*(?:步|阶段)?/g, "")
    .replace(/^(因为|原因是|理由是|改动是|改动为|需要|要|想)\s*/g, "")
    .trim();
  return stripped;
}

function truncateInline(text: string | null | undefined, maxLength = 34) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

type QuestionnaireInputType = "text" | "multi";

type QuestionnaireOption = {
  id: string;
  label: string;
  isOther: boolean;
};

type QuestionnaireField = {
  id: string;
  prompt: string;
  hint: string;
  inputType: QuestionnaireInputType;
  options: QuestionnaireOption[];
};

type ParsedQuestionnaire = {
  key: string;
  title: string;
  questions: QuestionnaireField[];
};

type QuestionnaireAnswer = {
  text: string;
  selectedOptionIds: string[];
  note: string;
};

type ParsedOption = {
  label: string;
  kind: "checkbox" | "alpha" | "bullet";
};

type QuestionnaireBlock = {
  heading: string;
  lines: string[];
};

function createEmptyQuestionnaireAnswer(): QuestionnaireAnswer {
  return {
    text: "",
    selectedOptionIds: [],
    note: "",
  };
}

function hasQuestionnaireAnswer(answer?: QuestionnaireAnswer | null) {
  if (!answer) return false;
  return (
    answer.selectedOptionIds.length > 0
    || answer.text.trim().length > 0
    || answer.note.trim().length > 0
  );
}

function stripMarkdown(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\>\s?/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseOptionLine(value: string): ParsedOption | null {
  const line = value.trim();
  if (!line) return null;

  const markdownCheckboxMatch = line.match(/^(?:[-*+]\s*)?\[[ xX]?\]\s*(.+)$/);
  if (markdownCheckboxMatch?.[1]) {
    return {
      kind: "checkbox",
      label: markdownCheckboxMatch[1],
    };
  }

  const checkboxMatch = line.match(/^(?:[-*+•]\s*)?[□☐▢]\s*(.+)$/);
  if (checkboxMatch?.[1]) {
    return {
      kind: "checkbox",
      label: checkboxMatch[1],
    };
  }

  const alphaMatch = line.match(
    /^(?:[-*+•]\s*)?(?:[（(]?([A-Za-z])[)）.]|([A-Za-z])[、.)])\s*(.+)$/
  );
  if (alphaMatch?.[3]) {
    return {
      kind: "alpha",
      label: alphaMatch[3],
    };
  }

  const bulletMatch = line.match(/^(?:[-*+•])\s*(.+)$/);
  if (bulletMatch?.[1]) {
    return {
      kind: "bullet",
      label: bulletMatch[1],
    };
  }

  const numericMatch = line.match(/^(?:[-*+•]\s*)?(?:\d{1,2}[.)、]|[（(]?\d{1,2}[)）])\s*(.+)$/);
  if (numericMatch?.[1]) {
    return {
      kind: "bullet",
      label: numericMatch[1],
    };
  }

  return null;
}

function isMarkdownTableDividerLine(value: string) {
  const line = value.trim();
  if (!line) return false;
  return /^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(line);
}

function extractTableQuestionCell(value: string) {
  const normalized = stripMarkdown(value).replace(/\s+/g, " ").trim();
  if (!normalized.includes("|")) return normalized;

  const cells = normalized
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean)
    .filter((cell) => !/^[:\-]{2,}$/.test(cell));

  if (cells.length === 0) {
    return normalized.replace(/\|+/g, " ").replace(/\s+/g, " ").trim();
  }

  const questionCell = cells.find((cell) => /([？?]|^(请|是否|能否|可否|如何|为什么|哪些|什么))/.test(cell));
  if (questionCell) return questionCell;

  const descriptiveCell = [...cells].reverse().find((cell) => cell.length >= 4);
  return descriptiveCell ?? cells[0];
}

function normalizeQuestionPromptLine(value: string) {
  const extracted = extractTableQuestionCell(value);
  return extracted
    .replace(/^\|+/, "")
    .replace(/\|+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanInlineOptionToken(raw: string) {
  const normalized = stripMarkdown(raw)
    .replace(/^(?:选项|可选项|候选项|范围)\s*[:：]\s*/i, "")
    .replace(/^(?:[A-Za-z]\s*[.)、:：]|[（(]?[A-Za-z][)）]\s*)/, "")
    .replace(/^(?:\d{1,2}\s*[.)、:：]|[（(]?\d{1,2}[)）]\s*)/, "")
    .replace(/^(?:可多选|多选|单选|可选|任选|例如|比如|如)/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "";
  if (normalized.length > 40) return "";
  if (/[。！？]/.test(normalized)) return "";
  return normalized;
}

function splitInlineOptionLabels(raw: string) {
  const normalized = stripMarkdown(raw).replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const candidate = normalized
    .replace(/^(?:选项|可选项|候选项|范围)\s*[:：]\s*/i, "")
    .trim();

  const labels = candidate
    .split(/[\/|｜、,，;；]/g)
    .map((token) => cleanInlineOptionToken(token))
    .filter(Boolean);

  const unique = Array.from(new Set(labels));
  if (unique.length < 2 || unique.length > 12) return [];
  return unique;
}

function extractInlineOptionsFromLine(line: string) {
  const normalized = stripMarkdown(line).replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 220) return [];

  const collected: string[] = [];
  const cueMatch = normalized.match(/(?:可选(?:项)?|选项|候选(?:项)?|范围)\s*[：:]\s*(.+)$/);
  if (cueMatch?.[1]) {
    collected.push(...splitInlineOptionLabels(cueMatch[1]));
  }

  const parenthesizedRegex = /[（(]([^（）()]{2,120})[)）]/g;
  let parenthesizedMatch = parenthesizedRegex.exec(normalized);
  while (parenthesizedMatch) {
    const content = parenthesizedMatch[1];
    if (/[\/|｜、,，;；]/.test(content)) {
      collected.push(...splitInlineOptionLabels(content));
    }
    parenthesizedMatch = parenthesizedRegex.exec(normalized);
  }

  if (/(单选|多选|可选|请选择|范围|类型|阶段|级别|优先级|环境|模式|渠道|角色|平台|系统|地区|语言|终端|来源|状态)/.test(normalized)) {
    const trailingCandidate = normalized.match(/[:：]\s*([^。！？]{3,120})$/)?.[1];
    if (trailingCandidate && /[\/|｜、,，;；]/.test(trailingCandidate)) {
      collected.push(...splitInlineOptionLabels(trailingCandidate));
    }
  }

  return Array.from(new Set(collected));
}

function splitQuestionBlocks(lines: string[]): QuestionnaireBlock[] {
  const headingRegex = /^(?:#{1,6}\s*)?(\d{1,2})[.)、]\s*(.+)$/;
  const blocks: QuestionnaireBlock[] = [];
  let current: QuestionnaireBlock | null = null;

  for (const line of lines) {
    const headingMatch = line.match(headingRegex);
    if (headingMatch?.[2]) {
      if (current && (current.heading || current.lines.length > 0)) {
        blocks.push(current);
      }
      current = {
        heading: stripMarkdown(headingMatch[2]),
        lines: [],
      };
      continue;
    }

    if (!current) {
      current = {
        heading: "",
        lines: [],
      };
    }

    current.lines.push(line);
  }

  if (current && (current.heading || current.lines.length > 0)) {
    blocks.push(current);
  }

  return blocks;
}

function parseQuestionBlock(block: QuestionnaireBlock, fieldIndex: number): QuestionnaireField | null {
  const questionLike = /(？|\?|是否|什么|哪些|如何|请|可否|希望|范围|标准|流程|目标|方式|输入|支持|约束|边界|模式|产物)/;
  const promptLineLike = /(？|\?|^(问题[:：]?|请|是否|能否|可否|如何|什么|哪些|从|当))/;
  const optionCue = /(可选|选项|模式|形式|支持哪些|多选|勾选|例如|请描述|单选|候选|范围|可选择)/;
  const yesNoCue = /(是否|能否|可否|有没有|是否需要|是否支持|是否存在)/;

  const normalizedLines = block.lines
    .filter((line) => !isMarkdownTableDividerLine(line))
    .map((line) => normalizeQuestionPromptLine(line))
    .filter(Boolean);

  if (!block.heading && normalizedLines.length === 0) return null;

  let prompt = "";
  let promptIndex = -1;

  for (let i = 0; i < normalizedLines.length; i += 1) {
    const line = normalizedLines[i].replace(/^问题[:：]\s*/, "").trim();
    if (!line) continue;
    if (promptLineLike.test(line) && line.length <= 180) {
      prompt = line;
      promptIndex = i;
      break;
    }
  }

  if (!prompt) {
    const headingPrompt = normalizeQuestionPromptLine(block.heading)
      .replace(/^第?\d{1,2}[章节步]?[：:\s-]*/, "")
      .trim();
    if (headingPrompt && (questionLike.test(headingPrompt) || normalizedLines.some((line) => parseOptionLine(line)))) {
      prompt = headingPrompt;
    }
  }

  if (!prompt || prompt.length < 4 || prompt.length > 180) return null;

  const hintParts: string[] = [];
  const cleanedHeading = normalizeQuestionPromptLine(block.heading);
  if (cleanedHeading && cleanedHeading !== prompt) {
    hintParts.push(cleanedHeading);
  }

  normalizedLines
    .filter((line) => line !== prompt && /例如[:：]/.test(line) && !parseOptionLine(line))
    .forEach((line) => hintParts.push(line));

  const optionLines = promptIndex >= 0 ? normalizedLines.slice(promptIndex + 1) : normalizedLines;
  const parsedOptionLines = optionLines.map((line) => ({
    line,
    parsed: parseOptionLine(line),
  }));
  let rawOptions = parsedOptionLines
    .map((item) => item.parsed)
    .filter((item): item is ParsedOption => Boolean(item));

  const inlineOptionLabels = rawOptions.length === 0
    ? Array.from(
      new Set([
        ...extractInlineOptionsFromLine(prompt),
        ...parsedOptionLines
          .filter((item) => !item.parsed)
          .flatMap((item) => extractInlineOptionsFromLine(item.line)),
        ...hintParts.flatMap((line) => extractInlineOptionsFromLine(line)),
      ])
    )
    : [];

  if (inlineOptionLabels.length > 0) {
    rawOptions = inlineOptionLabels.map((label) => ({ kind: "bullet" as const, label }));
  }

  if (rawOptions.length === 0 && yesNoCue.test(prompt)) {
    rawOptions = [
      { kind: "bullet", label: "是" },
      { kind: "bullet", label: "否" },
    ];
  }

  const hasStrongOptionMarker = rawOptions.some((option) => option.kind !== "bullet");
  const allowBulletOption = hasStrongOptionMarker
    || rawOptions.length === 0
    || inlineOptionLabels.length >= 2
    || optionCue.test(prompt)
    || optionCue.test(cleanedHeading);

  const seenOption = new Set<string>();
  const collectedOptions: QuestionnaireOption[] = [];
  rawOptions.forEach((option) => {
    if (option.kind === "bullet" && !allowBulletOption) return;

    const label = stripMarkdown(option.label).replace(/\s+/g, " ").trim();
    if (!label || label.length > 180 || seenOption.has(label)) return;

    seenOption.add(label);
    collectedOptions.push({
      id: `q${fieldIndex + 1}-o${collectedOptions.length + 1}`,
      label,
      isOther: /(其他|其它|补充|自定义|请描述)/.test(label),
    });
  });

  const options = collectedOptions.slice(0, 12);
  if (collectedOptions.length > options.length) {
    hintParts.push("选项较多，已展示前 12 项，其余可在补充说明中填写。");
  }

  let inputType: QuestionnaireInputType = "text";
  if (options.length > 0) {
    inputType = "multi";
  }

  if (options.length === 0 && !questionLike.test(prompt)) return null;

  return {
    id: `q${fieldIndex + 1}`,
    prompt,
    hint: Array.from(new Set(hintParts))
      .filter((item) => item && item.length <= 220)
      .join(" "),
    inputType,
    options,
  };
}

function parseFallbackQuestions(lines: string[]): QuestionnaireField[] {
  const questionRegexes = [
    /^\s*(?:[-*+]\s*)?(?:\d{1,2}[.)、]|[（(]?\d{1,2}[)）]|[一二三四五六七八九十]+[、.])\s*(.+)$/,
    /^\s*[-*+]\s*\[[ xX]?\]\s*(.+)$/,
    /^\s*Q\d*[:：]\s*(.+)$/i,
  ];
  const questionLike = /([？?]|是否|什么|哪些|如何|请|可否|希望|范围|标准|流程|目标)/;
  const directQuestionLine = /([？?]|^(请|是否|能否|可否|为什么|如何|哪些|什么))/;
  const candidates: string[] = [];

  for (const line of lines) {
    let matched = "";
    for (const regex of questionRegexes) {
      const result = line.match(regex);
      if (result?.[1]) {
        matched = result[1];
        break;
      }
    }

    if (!matched && line.length <= 120 && directQuestionLine.test(line)) {
      matched = line;
    }

    if (!matched) continue;

    const cleaned = normalizeQuestionPromptLine(matched)
      .replace(/[：:]\s*$/, "")
      .trim();

    if (cleaned.length < 6 || cleaned.length > 160) continue;
    if (!questionLike.test(cleaned)) continue;
    candidates.push(cleaned);
  }

  return Array.from(new Set(candidates))
    .slice(0, 12)
    .map((prompt, index) => {
      const inlineOptions = extractInlineOptionsFromLine(prompt);
      const isYesNo = /(是否|能否|可否|有没有|是否需要|是否支持|是否存在)/.test(prompt);
      const options = inlineOptions.length >= 2
        ? inlineOptions.map((label, optionIndex) => ({
          id: `q${index + 1}-o${optionIndex + 1}`,
          label,
          isOther: /(其他|其它|补充|自定义|请描述)/.test(label),
        }))
        : (
          isYesNo
            ? [
              { id: `q${index + 1}-o1`, label: "是", isOther: false },
              { id: `q${index + 1}-o2`, label: "否", isOther: false },
            ]
            : []
        );

      let inputType: QuestionnaireInputType = "text";
      if (options.length > 0) {
        inputType = "multi";
      }

      return {
        id: `q${index + 1}`,
        prompt,
        hint: "",
        inputType,
        options,
      };
    });
}

function parseQuestionnaire(markdown: string | null | undefined): ParsedQuestionnaire | null {
  const normalized = normalizeMarkdownContent(String(markdown ?? ""));
  if (!normalized) return null;

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !isMarkdownTableDividerLine(line))
    .filter(Boolean);

  if (lines.length === 0) return null;

  const questionCues = /(问卷|请回答|请补充|问题清单|请确认|请提供|请填写|待回答|继续补充)/;
  const directQuestionLine = /([？?]|^(请|是否|能否|可否|为什么|如何|哪些|什么))/;
  const likelyAnswerSummary = /(我已完成.+问卷|回答如下|^答[:：])/m;

  if (likelyAnswerSummary.test(normalized)) {
    return null;
  }

  let title = "交互式问卷";
  for (const line of lines) {
    if (!line.startsWith("#")) continue;
    const cleaned = stripMarkdown(line);
    if (cleaned.length >= 4 && cleaned.length <= 48) {
      title = cleaned;
      break;
    }
  }

  const blocks = splitQuestionBlocks(lines);
  const parsedQuestions: QuestionnaireField[] = [];
  const seenPrompt = new Set<string>();

  for (const block of blocks) {
    const parsed = parseQuestionBlock(block, parsedQuestions.length);
    if (!parsed) continue;
    if (seenPrompt.has(parsed.prompt)) continue;
    seenPrompt.add(parsed.prompt);
    parsedQuestions.push(parsed);
  }

  if (parsedQuestions.length < 2) {
    parseFallbackQuestions(lines).forEach((question) => {
      if (seenPrompt.has(question.prompt)) return;
      seenPrompt.add(question.prompt);
      parsedQuestions.push(question);
    });
  }

  const directQuestionCount = parsedQuestions.filter((item) => directQuestionLine.test(item.prompt)).length;
  const hasSelectableOptions = parsedQuestions.some((item) => item.options.length > 0);
  const shouldRender = parsedQuestions.length >= 2
    && (questionCues.test(normalized) || directQuestionCount >= 2 || hasSelectableOptions);

  if (!shouldRender) return null;

  return {
    key: [
      title,
      ...parsedQuestions.map((question) =>
        `${question.prompt}|${question.inputType}|${question.options.map((option) => option.label).join("&&")}`
      ),
    ].join("||"),
    title,
    questions: parsedQuestions,
  };
}

function flattenMultilineAnswer(value: string) {
  return value
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" / ");
}

function buildQuestionnaireReply(
  questionnaire: ParsedQuestionnaire,
  answers: Record<string, QuestionnaireAnswer>
) {
  const lines: string[] = [`我已完成「${questionnaire.title}」问卷，回答如下：`, ""];
  let answered = 0;

  questionnaire.questions.forEach((question, index) => {
    const answer = answers[question.id] ?? createEmptyQuestionnaireAnswer();
    const optionText = question.options
      .filter((option) => answer.selectedOptionIds.includes(option.id))
      .map((option) => option.label)
      .join("、");
    const noteText = flattenMultilineAnswer(answer.note);
    const freeText = flattenMultilineAnswer(answer.text);
    const answerParts = [
      optionText ? `- 选择：${optionText}` : "",
      freeText ? `- 回答：${freeText}` : "",
      noteText ? `- 补充：${noteText}` : "",
    ].filter(Boolean);

    if (answerParts.length === 0) return;
    answered += 1;
    lines.push(`${index + 1}. **${question.prompt}**`);
    lines.push(...answerParts);
    lines.push("");
  });

  if (answered === 0) return "";
  lines.push("如有遗漏，请继续追问。");
  return lines.join("\n").trim();
}

export default function ProjectDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = Number.parseInt(params.id || "0", 10);
  const isValidProjectId = Number.isFinite(projectId) && projectId > 0;

  const [userMessage, setUserMessage] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  const [uploadScope, setUploadScope] = useState<"project" | "step">("project");
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const [assetPanelCollapsed, setAssetPanelCollapsed] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget>(null);
  const [assetPreviewModalOpen, setAssetPreviewModalOpen] = useState(false);
  const [assetHistoryLimit, setAssetHistoryLimit] = useState(120);
  const [questionnaireAnswers, setQuestionnaireAnswers] = useState<Record<string, QuestionnaireAnswer>>({});
  const [pendingJumpTarget, setPendingJumpTarget] = useState<number | null>(null);
  const [pendingRewindReason, setPendingRewindReason] = useState<string>("");
  const [commandNotice, setCommandNotice] = useState<string>("");
  const [commandNoticeTone, setCommandNoticeTone] = useState<CommandNoticeTone>("info");
  const [archivedAssetKeys, setArchivedAssetKeys] = useState<Record<string, true>>({});
  const [showSlowLoadingHint, setShowSlowLoadingHint] = useState(false);

  const conversationScrollRef = useRef<HTMLDivElement>(null);
  const sendLockRef = useRef(false);
  const pendingConversationSizeRef = useRef(0);

  const showCommandNotice = (text: string, tone: CommandNoticeTone = "info") => {
    setCommandNotice(text);
    setCommandNoticeTone(tone);
  };

  const {
    data: project,
    isLoading: projectLoading,
    refetch: refetchProject,
    error: projectError,
  } = trpc.projects.get.useQuery(
    { projectId },
    { enabled: isValidProjectId, retry: 1 }
  );
  const {
    data: steps,
    isLoading: stepsLoading,
    refetch: refetchSteps,
    error: stepsError,
  } = trpc.workflow.getSteps.useQuery(
    { projectId },
    { enabled: Boolean(project), retry: 1 }
  );

  const activeStepNumber = Math.min(project?.currentStep ?? 0, 8);
  const workflowCompleted = (project?.currentStep ?? 0) >= 9;

  const { data: conversation, refetch: refetchConversation } = trpc.workflow.getConversationTimeline.useQuery(
    { projectId },
    { enabled: Boolean(project) }
  );

  const { data: artifactsData, refetch: refetchArtifacts } = trpc.workflow.getArtifacts.useQuery(
    { projectId, limit: assetHistoryLimit },
    { enabled: Boolean(project) }
  );
  const { data: uploadedAssetsData, refetch: refetchUploadedAssets } = trpc.workflow.getAssets.useQuery(
    { projectId, limit: assetHistoryLimit },
    { enabled: Boolean(project) }
  );

  const continueConversationMutation = trpc.workflow.continueConversation.useMutation();
  const confirmStepMutation = trpc.workflow.confirmStep.useMutation();
  const applyChangePlanMutation = trpc.workflow.applyChangePlan.useMutation();
  const uploadAssetMutation = trpc.workflow.uploadAsset.useMutation();
  const exportPrdMutation = trpc.workflow.exportPrd.useMutation();

  const artifacts = artifactsData?.items ?? [];
  const uploadedAssets = uploadedAssetsData?.items ?? [];
  const canLoadMoreAssets = artifacts.length >= assetHistoryLimit || uploadedAssets.length >= assetHistoryLimit;

  const completedStepCount = useMemo(() => {
    const fromProject = Math.max(0, Math.min(project?.currentStep ?? 0, 9));
    const fromSteps = (steps ?? []).filter((step) => step.status === "completed").length;
    return Math.max(fromProject, fromSteps);
  }, [project?.currentStep, steps]);

  const progressPercent = Math.round((completedStepCount / 9) * 100);

  const archiveStorageKey = useMemo(
    () => `pf:archived-assets:project:${projectId}`,
    [projectId]
  );

  const outputArtifacts = useMemo(
    () =>
      artifacts.filter(
        (item) =>
          USER_VISIBLE_ARTIFACT_TYPES.has(item.artifactType) &&
          (item.source === "agent" || item.source === "system")
      ),
    [artifacts]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(archiveStorageKey);
      if (!raw) {
        setArchivedAssetKeys({});
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, true>;
      setArchivedAssetKeys(parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      setArchivedAssetKeys({});
    }
  }, [archiveStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(archiveStorageKey, JSON.stringify(archivedAssetKeys));
    } catch {
      // ignore storage failures
    }
  }, [archivedAssetKeys, archiveStorageKey]);

  const makeAssetKey = (kind: "artifact" | "upload", id: number) => `${kind}:${id}`;
  const isAssetArchived = (kind: "artifact" | "upload", id: number) =>
    Boolean(archivedAssetKeys[makeAssetKey(kind, id)]);
  const toggleAssetArchived = (kind: "artifact" | "upload", id: number) => {
    const key = makeAssetKey(kind, id);
    setArchivedAssetKeys((current) => {
      if (current[key]) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return {
        ...current,
        [key]: true,
      };
    });
  };

  const activeArtifacts = useMemo(
    () => outputArtifacts.filter((item) => !isAssetArchived("artifact", item.id)),
    [outputArtifacts, archivedAssetKeys]
  );
  const activeUploads = useMemo(
    () => uploadedAssets.filter((item) => !isAssetArchived("upload", item.id)),
    [uploadedAssets, archivedAssetKeys]
  );

  const inlineArtifacts = useMemo(() => {
    const scoped = outputArtifacts.filter(
      (item) =>
        !isAssetArchived("artifact", item.id) &&
        (item.stepNumber === activeStepNumber || item.stepNumber == null)
    );

    const dedup = new Set<string>();
    const result: typeof scoped = [];
    for (const artifact of scoped) {
      const key = `${artifact.artifactType}:${artifact.title}`;
      if (dedup.has(key)) continue;
      dedup.add(key);
      result.push(artifact);
      if (result.length >= 3) break;
    }
    return result;
  }, [outputArtifacts, activeStepNumber, archivedAssetKeys]);

  const assetHistoryItems = useMemo<AssetHistoryItem[]>(() => {
    const artifactHistory: AssetHistoryItem[] = outputArtifacts.map((artifact) => {
      const stepLabel = typeof artifact.stepNumber === "number" ? `Step ${artifact.stepNumber + 1}` : "项目级";
      return {
        key: makeAssetKey("artifact", artifact.id),
        kind: "artifact",
        id: artifact.id,
        title: artifact.title,
        subtitle: `${stepLabel} · ${artifact.artifactType} · ${formatDate(artifact.createdAt)}`,
        createdAt: artifact.createdAt,
        latestLabel: "Agent文件",
      };
    });

    const uploadHistory: AssetHistoryItem[] = uploadedAssets.map((upload) => ({
      key: makeAssetKey("upload", upload.id),
      kind: "upload",
      id: upload.id,
      title: upload.fileName,
      subtitle: `${upload.scope}${typeof upload.stepNumber === "number" ? ` · Step ${upload.stepNumber + 1}` : ""} · ${typeof upload.fileSize === "number" ? `${(upload.fileSize / 1024).toFixed(1)} KB` : "大小未知"}`,
      createdAt: upload.createdAt,
      latestLabel: "用户文件",
    }));

    return [...artifactHistory, ...uploadHistory].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [outputArtifacts, uploadedAssets]);

  const activeHistoryItems = useMemo(
    () => assetHistoryItems.filter((item) => !archivedAssetKeys[item.key]),
    [assetHistoryItems, archivedAssetKeys]
  );
  const archivedHistoryItems = useMemo(
    () => assetHistoryItems.filter((item) => archivedAssetKeys[item.key]),
    [assetHistoryItems, archivedAssetKeys]
  );

  const previewArtifact =
    previewTarget?.kind === "artifact"
      ? outputArtifacts.find((item) => item.id === previewTarget.id) ?? null
      : null;

  const previewUpload =
    previewTarget?.kind === "upload"
      ? uploadedAssets.find((item) => item.id === previewTarget.id) ?? null
      : null;

  const openAssetPreview = (target: Exclude<PreviewTarget, null>) => {
    setPreviewTarget(target);
    setAssetPreviewModalOpen(true);
  };

  const activeStep = steps?.find((item) => item.stepNumber === activeStepNumber) ?? null;

  const latestAssistantMessage = useMemo(() => {
    const history = conversation ?? [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i]?.role === "assistant" && history[i]?.stepNumber === activeStepNumber) {
        return history[i];
      }
    }
    return null;
  }, [conversation, activeStepNumber]);

  const questionnaireSourceText = latestAssistantMessage?.content
    ?? (typeof activeStep?.output?.text === "string" ? activeStep.output.text : "");

  const activeQuestionnaire = useMemo(
    () => parseQuestionnaire(questionnaireSourceText),
    [questionnaireSourceText]
  );

  const answeredQuestionCount = useMemo(() => {
    if (!activeQuestionnaire) return 0;
    return activeQuestionnaire.questions.reduce((count, item) => {
      return count + (hasQuestionnaireAnswer(questionnaireAnswers[item.id]) ? 1 : 0);
    }, 0);
  }, [activeQuestionnaire, questionnaireAnswers]);

  const conversationInsight = useMemo(() => {
    const history = conversation ?? [];
    const visibleMessages = history.filter((item) => item.role !== "system");
    const userMessages = history.filter((item) => item.role === "user");
    const currentStepMessages = history.filter(
      (item) => item.stepNumber === activeStepNumber && item.role !== "system"
    );
    const currentStepUserMessages = currentStepMessages.filter((item) => item.role === "user");

    return {
      messageCount: visibleMessages.length,
      roundCount: userMessages.length,
      currentStepMessageCount: currentStepMessages.length,
      currentStepRoundCount: currentStepUserMessages.length,
      lastUserText: truncateInline(userMessages[userMessages.length - 1]?.content),
      prevUserText: truncateInline(userMessages[userMessages.length - 2]?.content),
    };
  }, [conversation, activeStepNumber]);

  const questionnaireDraftStorageKey = useMemo(() => {
    if (!activeQuestionnaire) return "";
    return `pf:questionnaire-draft:${projectId}:${activeStepNumber}:${activeQuestionnaire.key}`;
  }, [activeQuestionnaire, projectId, activeStepNumber]);

  useEffect(() => {
    if (activeArtifacts.length > 0) {
      setPreviewTarget((prev) => {
        if (prev?.kind === "artifact" && activeArtifacts.some((item) => item.id === prev.id)) {
          return prev;
        }
        return { kind: "artifact", id: activeArtifacts[0].id };
      });
      return;
    }

    if (activeUploads.length > 0) {
      setPreviewTarget((prev) => {
        if (prev?.kind === "upload" && activeUploads.some((item) => item.id === prev.id)) {
          return prev;
        }
        return { kind: "upload", id: activeUploads[0].id };
      });
      return;
    }

    setPreviewTarget(null);
  }, [activeArtifacts, activeUploads]);

  useEffect(() => {
    const node = conversationScrollRef.current;
    if (!node) return;

    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [conversation?.length, isExecuting]);

  useEffect(() => {
    if (!commandNotice) return;
    const timer = window.setTimeout(() => {
      setCommandNotice("");
      setCommandNoticeTone("info");
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [commandNotice]);

  useEffect(() => {
    if (!projectLoading) {
      setShowSlowLoadingHint(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowSlowLoadingHint(true);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [projectLoading]);

  useEffect(() => {
    if (!activeQuestionnaire) {
      setQuestionnaireAnswers({});
      return;
    }

    let savedDraft: Record<string, QuestionnaireAnswer> = {};
    if (typeof window !== "undefined" && questionnaireDraftStorageKey) {
      try {
        const raw = window.localStorage.getItem(questionnaireDraftStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, QuestionnaireAnswer>;
          if (parsed && typeof parsed === "object") {
            savedDraft = parsed;
          }
        }
      } catch {
        savedDraft = {};
      }
    }

    setQuestionnaireAnswers(() => {
      const next: Record<string, QuestionnaireAnswer> = {};
      activeQuestionnaire.questions.forEach((question) => {
        const previous = savedDraft[question.id] ?? createEmptyQuestionnaireAnswer();
        const validOptionIds = new Set(question.options.map((option) => option.id));
        next[question.id] = {
          text: previous.text,
          note: previous.note,
          selectedOptionIds: previous.selectedOptionIds.filter((optionId) => validOptionIds.has(optionId)),
        };
      });
      return next;
    });
  }, [activeQuestionnaire?.key, questionnaireDraftStorageKey]);

  useEffect(() => {
    if (!activeQuestionnaire || !questionnaireDraftStorageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(questionnaireDraftStorageKey, JSON.stringify(questionnaireAnswers));
    } catch {
      // ignore storage failures
    }
  }, [activeQuestionnaire, questionnaireAnswers, questionnaireDraftStorageKey]);

  useEffect(() => {
    if (!isExecuting) return;

    const timer = window.setInterval(() => {
      void refetchProject();
      void refetchSteps();
      void refetchConversation();
      void refetchArtifacts();
      void refetchUploadedAssets();
    }, 2200);

    return () => window.clearInterval(timer);
  }, [
    isExecuting,
    refetchArtifacts,
    refetchConversation,
    refetchProject,
    refetchSteps,
    refetchUploadedAssets,
  ]);

  useEffect(() => {
    if (!isExecuting) return;

    const history = conversation ?? [];
    const hasNewAssistantReply = history
      .slice(pendingConversationSizeRef.current)
      .some((item) => item.role === "assistant");

    if (!hasNewAssistantReply) return;

    sendLockRef.current = false;
    setIsExecuting(false);
  }, [conversation, isExecuting]);

  const refetchAllForSelected = async () => {
    await Promise.all([
      refetchProject(),
      refetchSteps(),
      refetchConversation(),
      refetchArtifacts(),
      refetchUploadedAssets(),
    ]);
  };

  const handleContinueConversation = async (message: string) => {
    if (!project || !message.trim() || sendLockRef.current) return;

    const content = message.trim();
    pendingConversationSizeRef.current = conversation?.length ?? 0;
    sendLockRef.current = true;
    setIsExecuting(true);
    setUserMessage("");

    try {
      await continueConversationMutation.mutateAsync({
        projectId: project.id,
        stepNumber: activeStepNumber,
        userMessage: content,
      });

      await refetchAllForSelected();
    } catch (error: any) {
      setUserMessage((current) => (current.trim() ? current : content));
      toast.error(error.message || "对话失败");
    } finally {
      sendLockRef.current = false;
      setIsExecuting(false);
    }
  };

  const rewindToStepWithReset = async (targetStep: number, reason: string) => {
    if (!project) return;
    if (targetStep < 0 || targetStep > 8) return;

    if (targetStep >= activeStepNumber) {
      await jumpToStepWithConfirmation(targetStep);
      return;
    }

    pendingConversationSizeRef.current = conversation?.length ?? 0;
    sendLockRef.current = true;
    setIsExecuting(true);

    try {
      await applyChangePlanMutation.mutateAsync({
        projectId: project.id,
        startStep: targetStep,
        changeRequest: reason || `用户要求回到 Step ${targetStep + 1} 重做`,
      });
      await refetchAllForSelected();
      showCommandNotice(`已回到 Step ${targetStep + 1} 并重置其后的步骤。历史文件仍保留在资产面板。`, "success");
    } catch (error: any) {
      toast.error(error.message || "步骤回改失败");
    } finally {
      sendLockRef.current = false;
      setIsExecuting(false);
    }
  };

  const jumpToStepWithConfirmation = async (targetStep: number) => {
    if (!project) return;
    if (targetStep < 0 || targetStep > 8) return;

    if (targetStep === activeStepNumber) {
      showCommandNotice(`你当前就在 Step ${targetStep + 1}。`, "info");
      return;
    }

    if (targetStep < activeStepNumber) {
      showCommandNotice(`如需回改，请使用“回到第${targetStep + 1}步重做”。`, "warning");
      return;
    }

    pendingConversationSizeRef.current = conversation?.length ?? 0;
    sendLockRef.current = true;
    setIsExecuting(true);

    try {
      for (let step = activeStepNumber; step < targetStep; step += 1) {
        await confirmStepMutation.mutateAsync({
          projectId: project.id,
          stepNumber: step,
        });
      }

      await refetchAllForSelected();
      const reachedLabel = targetStep >= 8 ? "第 9 步（最后一步）" : `Step ${targetStep + 1}`;
      showCommandNotice(`已根据你的指令切换到 ${reachedLabel}。`, "success");
    } catch (error: any) {
      toast.error(error.message || "步骤切换失败");
    } finally {
      sendLockRef.current = false;
      setIsExecuting(false);
    }
  };

  const completeWorkflowFromLastStep = async () => {
    if (!project) return;
    if (workflowCompleted) {
      showCommandNotice("流程已完成。你可以继续回改任一步骤，或导出 PRD。", "success");
      return;
    }
    if (activeStepNumber < 8) {
      showCommandNotice("请先推进到第 9 步，再完成流程。", "warning");
      return;
    }

    pendingConversationSizeRef.current = conversation?.length ?? 0;
    sendLockRef.current = true;
    setIsExecuting(true);
    try {
      await confirmStepMutation.mutateAsync({
        projectId: project.id,
        stepNumber: 8,
      });
      await refetchAllForSelected();
      showCommandNotice("9 步流程已完成。你可以导出 PRD，或继续回改优化。", "success");
    } catch (error: any) {
      toast.error(error.message || "流程完成失败");
    } finally {
      sendLockRef.current = false;
      setIsExecuting(false);
    }
  };

  const handleMessageKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage();
    }
  };

  const handleSendMessage = async () => {
    if (sendLockRef.current || isExecuting) return;

    const content = userMessage.trim();
    if (!content) return;

    const command = parseStepCommand(content, activeStepNumber, pendingJumpTarget);
    if (command) {
      if (command.type === "complete") {
        setPendingJumpTarget(null);
        setPendingRewindReason("");
        setUserMessage("");
        await completeWorkflowFromLastStep();
        return;
      }

      if (command.type === "confirm_jump") {
        const shouldRewind = command.targetStep < activeStepNumber;
        const rewindReason = pendingRewindReason;
        setPendingJumpTarget(null);
        setPendingRewindReason("");
        setUserMessage("");
        if (shouldRewind) {
          await rewindToStepWithReset(command.targetStep, rewindReason);
        } else {
          await jumpToStepWithConfirmation(command.targetStep);
        }
        return;
      }

      if (command.targetStep === activeStepNumber) {
        setPendingJumpTarget(null);
        setPendingRewindReason("");
        setUserMessage("");
        await jumpToStepWithConfirmation(command.targetStep);
        return;
      }

      const isRewindCommand = command.intent === "rewind" || command.targetStep < activeStepNumber;
      if (isRewindCommand) {
        const reason = extractRewindReason(content);
        setPendingJumpTarget(command.targetStep);
        setPendingRewindReason(reason);
        setUserMessage("");
        showCommandNotice(
          `检测到回改指令：Step ${activeStepNumber + 1} -> Step ${command.targetStep + 1}。确认后会重置中间步骤并保留文件历史${reason ? `（变更：${reason}）` : ""}，请回复“确认”。`,
          "warning"
        );
        return;
      }

      const leap = command.targetStep - activeStepNumber;
      if (leap > 1) {
        setPendingJumpTarget(command.targetStep);
        setPendingRewindReason("");
        setUserMessage("");
        showCommandNotice(
          `检测到跨步指令：Step ${activeStepNumber + 1} -> Step ${command.targetStep + 1}。如确认，请回复“确认”。`,
          "warning"
        );
        return;
      }

      setPendingJumpTarget(null);
      setPendingRewindReason("");
      setUserMessage("");
      await jumpToStepWithConfirmation(command.targetStep);
      return;
    }

    setPendingJumpTarget(null);
    setPendingRewindReason("");
    setCommandNotice("");
    setCommandNoticeTone("info");
    await handleContinueConversation(content);
  };

  const handleQuestionnaireAnswerChange = (questionId: string, value: string) => {
    setQuestionnaireAnswers((current) => ({
      ...current,
      [questionId]: {
        ...(current[questionId] ?? createEmptyQuestionnaireAnswer()),
        text: value,
      },
    }));
  };

  const handleQuestionnaireNoteChange = (questionId: string, value: string) => {
    setQuestionnaireAnswers((current) => ({
      ...current,
      [questionId]: {
        ...(current[questionId] ?? createEmptyQuestionnaireAnswer()),
        note: value,
      },
    }));
  };

  const handleQuestionnaireOptionChange = (
    question: QuestionnaireField,
    optionId: string,
    checked: boolean
  ) => {
    setQuestionnaireAnswers((current) => {
      const previous = current[question.id] ?? createEmptyQuestionnaireAnswer();
      const selectedOptionIds = checked
        ? Array.from(new Set([...previous.selectedOptionIds, optionId]))
        : previous.selectedOptionIds.filter((id) => id !== optionId);

      return {
        ...current,
        [question.id]: {
          ...previous,
          selectedOptionIds,
        },
      };
    });
  };

  const replaceQuestionnaireOptionSelections = (
    question: QuestionnaireField,
    optionIds: string[]
  ) => {
    const validOptionIds = new Set(question.options.map((option) => option.id));
    const normalized = optionIds.filter((id) => validOptionIds.has(id));
    setQuestionnaireAnswers((current) => ({
      ...current,
      [question.id]: {
        ...(current[question.id] ?? createEmptyQuestionnaireAnswer()),
        selectedOptionIds: Array.from(new Set(normalized)),
      },
    }));
  };

  const clearQuestionnaireField = (questionId: string) => {
    setQuestionnaireAnswers((current) => ({
      ...current,
      [questionId]: createEmptyQuestionnaireAnswer(),
    }));
  };

  const handleExportPrd = async () => {
    if (!project || exportPrdMutation.isPending) return;

    try {
      const result = await exportPrdMutation.mutateAsync({
        projectId: project.id,
      });

      const blob = new Blob([result.content], { type: result.mimeType || "text/markdown;charset=utf-8" });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = result.fileName || `${project.title}-PRD.md`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);

      setAssetPanelCollapsed(false);
      await refetchAllForSelected();
      toast.success("PRD 已导出并加入项目资产");
    } catch (error: any) {
      toast.error(error.message || "PRD 导出失败");
    }
  };

  const handleSubmitQuestionnaire = async () => {
    if (!activeQuestionnaire || sendLockRef.current || isExecuting) return;

    const userReply = buildQuestionnaireReply(activeQuestionnaire, questionnaireAnswers);
    if (!userReply) {
      toast.error("请先填写至少一个问题");
      return;
    }

    await handleContinueConversation(userReply);
    if (typeof window !== "undefined" && questionnaireDraftStorageKey) {
      try {
        window.localStorage.removeItem(questionnaireDraftStorageKey);
      } catch {
        // ignore storage failures
      }
    }
  };

  const questionnaireMessageId = activeQuestionnaire && latestAssistantMessage
    ? latestAssistantMessage.id
    : null;

  const showStepOutputQuestionnaire = Boolean(
    activeQuestionnaire
    && !latestAssistantMessage
    && activeStep?.output?.text
  );

  const renderQuestionnaireCard = () => {
    if (!activeQuestionnaire) return null;
    const unansweredCount = Math.max(0, activeQuestionnaire.questions.length - answeredQuestionCount);
    const visibleQuestions = activeQuestionnaire.questions;

    return (
      <div className="questionnaire-card">
        <div className="questionnaire-header">
          <h3>{activeQuestionnaire.title}</h3>
          <p>直接勾选选项并补充说明，提交后系统会自动整理成结构化回复。</p>
          <div className="questionnaire-toolbar">
            <span className="questionnaire-progress">待回答 {unansweredCount} 题</span>
            {questionnaireDraftStorageKey ? (
              <span className="questionnaire-draft-tip">草稿自动保存</span>
            ) : null}
          </div>
        </div>

        <div className="questionnaire-fields">
          {visibleQuestions.map((question, index) => {
            const answer = questionnaireAnswers[question.id] ?? createEmptyQuestionnaireAnswer();
            const selectedOptionIds = new Set(answer.selectedOptionIds);
            const selectedCount = answer.selectedOptionIds.length;
            const answered = hasQuestionnaireAnswer(answer);
            const showNoteInput = question.options.some(
              (option) => option.isOther && selectedOptionIds.has(option.id)
            );

            return (
              <div key={question.id} className="questionnaire-field">
                <div className="questionnaire-field-head">
                  <span className="questionnaire-label">
                    {index + 1}. {question.prompt}
                  </span>
                  <div className="questionnaire-field-actions">
                    <span className={`questionnaire-state ${answered ? "answered" : "pending"}`}>
                      {answered ? "已回答" : "待回答"}
                    </span>
                    {answered ? (
                      <button
                        type="button"
                        className="questionnaire-action-link"
                        onClick={() => clearQuestionnaireField(question.id)}
                      >
                        清空
                      </button>
                    ) : null}
                  </div>
                </div>
                {question.hint ? (
                  <span className="questionnaire-hint">{question.hint}</span>
                ) : null}

                {question.options.length > 0 ? (
                  <div className="questionnaire-option-block">
                    <div className="questionnaire-option-meta">
                      <span>
                        {`多选 · 已选 ${selectedCount}/${question.options.length}`}
                      </span>
                      <div className="questionnaire-option-actions">
                        {question.options.length > 1 ? (
                          <>
                            <button
                              type="button"
                              className="questionnaire-action-link"
                              onClick={() =>
                                replaceQuestionnaireOptionSelections(
                                  question,
                                  question.options.map((option) => option.id)
                                )}
                            >
                              全选
                            </button>
                            <button
                              type="button"
                              className="questionnaire-action-link"
                              disabled={selectedCount === 0}
                              onClick={() => replaceQuestionnaireOptionSelections(question, [])}
                            >
                              清空
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="questionnaire-action-link"
                            disabled={selectedCount === 0}
                            onClick={() => replaceQuestionnaireOptionSelections(question, [])}
                          >
                            清空选择
                          </button>
                        )}
                      </div>
                    </div>

                    <div className={`questionnaire-options ${question.inputType}`}>
                      {question.options.map((option) => (
                        <label
                          key={option.id}
                          className={`questionnaire-option ${selectedOptionIds.has(option.id) ? "active" : ""}`}
                        >
                          <input
                            type="checkbox"
                            name={question.id}
                            checked={selectedOptionIds.has(option.id)}
                            onChange={(event) =>
                              handleQuestionnaireOptionChange(question, option.id, event.target.checked)
                            }
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {question.options.length === 0 ? (
                  <textarea
                    className="questionnaire-input"
                    value={answer.text}
                    onChange={(event) => handleQuestionnaireAnswerChange(question.id, event.target.value)}
                    placeholder="请填写你的回答..."
                    rows={3}
                  />
                ) : (
                  <div className="questionnaire-followup">
                    {showNoteInput ? (
                      <textarea
                        className="questionnaire-input"
                        value={answer.note}
                        onChange={(event) => handleQuestionnaireNoteChange(question.id, event.target.value)}
                        placeholder="请补充“其他”选项的说明..."
                        rows={2}
                      />
                    ) : null}
                    <textarea
                      className="questionnaire-input compact"
                      value={answer.text}
                      onChange={(event) => handleQuestionnaireAnswerChange(question.id, event.target.value)}
                      placeholder="可选：补充细节、限制条件或例外情况..."
                      rows={2}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="questionnaire-actions">
          <span className="questionnaire-meta">
            已填写 {answeredQuestionCount}/{activeQuestionnaire.questions.length}
          </span>
          <button
            type="button"
            className="questionnaire-submit"
            onClick={() => {
              void handleSubmitQuestionnaire();
            }}
            disabled={isExecuting}
          >
            完成并提交问卷
          </button>
        </div>
      </div>
    );
  };

  const openUploadDialog = (scope: "project" | "step") => {
    setUploadScope(scope);
    uploadInputRef.current?.click();
  };

  const handleAssetUpload: ChangeEventHandler<HTMLInputElement> = async (event) => {
    if (!project) return;
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    try {
      for (const file of files) {
        if (file.size > 15 * 1024 * 1024) {
          toast.error(`${file.name} 超过 15MB，已跳过`);
          continue;
        }

        const base64Data = await fileToBase64(file);
        const mimeType = file.type || "application/octet-stream";
        const assetType = mimeType.startsWith("image/")
          ? "image"
          : mimeType.includes("pdf") || mimeType.startsWith("text/") || mimeType.includes("officedocument")
            ? "document"
            : "other";

        await uploadAssetMutation.mutateAsync({
          projectId: project.id,
          stepNumber: uploadScope === "step" ? activeStepNumber : undefined,
          scope: uploadScope,
          assetType,
          fileName: file.name,
          mimeType,
          base64Data,
        });
      }

      await refetchAllForSelected();
      setAssetPanelCollapsed(false);
      toast.success("资产上传完成");
    } catch (error: any) {
      toast.error(error.message || "上传失败");
    } finally {
      event.target.value = "";
    }
  };

  const handleHistoryItemPreview = (item: AssetHistoryItem) => {
    if (item.kind === "artifact") {
      openAssetPreview({ kind: "artifact", id: item.id });
      return;
    }
    openAssetPreview({ kind: "upload", id: item.id });
  };

  if (!isValidProjectId) {
    return (
      <div className="pf-page flex min-h-screen items-center justify-center px-4">
        <div className="pf-side-card max-w-lg">
          <h3>项目地址无效</h3>
          <p>当前 URL 中的项目 ID 不合法，请返回首页重新进入。</p>
          <div className="pf-side-buttons">
            <button type="button" className="pf-btn-primary" onClick={() => setLocation("/")}>
              返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (projectLoading) {
    return (
      <div className="pf-page flex min-h-screen items-center justify-center px-4">
        <div className="pf-side-card max-w-md text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--pf-text-secondary)]" />
          <h3 className="mt-3">正在加载项目页面</h3>
          <p className="mt-2">
            正在读取项目信息和步骤数据。
            {showSlowLoadingHint ? " 如果停留较久，请点击重试。" : ""}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              className="pf-btn-secondary"
              onClick={() => {
                void refetchProject();
              }}
            >
              重试加载
            </button>
            <button type="button" className="pf-btn-primary" onClick={() => setLocation("/")}>
              返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="pf-page flex min-h-screen items-center justify-center px-4">
        <div className="pf-side-card max-w-lg">
          <h3>{projectError ? "项目加载失败" : "项目不存在"}</h3>
          <p>
            {projectError
              ? "读取项目时发生错误，请重试。"
              : "该项目可能已删除或你没有访问权限。"}
          </p>
          <div className="pf-side-buttons">
            <button
              type="button"
              className="pf-btn-secondary"
              onClick={() => {
                void refetchProject();
              }}
            >
              重试
            </button>
            <button type="button" className="pf-btn-primary" onClick={() => setLocation("/")}>
              返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pf-page pf-workspace-page">
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.xml,.yaml,.yml,.png,.jpg,.jpeg,.webp,.gif"
        onChange={handleAssetUpload}
      />

      <header className="topbar">
        <div className="topbar-left">
          <button type="button" className="topbar-btn" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-4 w-4" />
            返回
          </button>
          <span className="topbar-brand">ProductFlow</span>
          <span className="topbar-sep" />
          <span className="topbar-project">{project.title}</span>
        </div>

        <div className="topbar-right">
          <div className="topbar-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <span>{completedStepCount}/9</span>
          </div>

          <div className="topbar-step-pill">
            {workflowCompleted ? "总计 9 步 · 已完成" : `总计 9 步 · 已完成 ${completedStepCount}/9`}
          </div>

          <button
            type="button"
            className="topbar-btn"
            onClick={() => setLocation("/settings")}
          >
            <Settings2 className="h-4 w-4" />
            设置
          </button>

          <button
            type="button"
            className="topbar-btn"
            onClick={() => setAssetPanelCollapsed((prev) => !prev)}
          >
            <LayoutPanelTop className="h-4 w-4" />
            资产
          </button>

          <button
            type="button"
            className="topbar-btn"
            onClick={() => {
              void handleExportPrd();
            }}
            disabled={exportPrdMutation.isPending}
          >
            {exportPrdMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            导出 PRD
          </button>
        </div>
      </header>

      <div className="main">
        <div className="conversation-area">
          <div ref={conversationScrollRef} className="conversation-scroll">
            <div className="conversation-inner stagger">
              <section>
                <div className="workflow-guidance">
                  <p className="workflow-guidance-title">
                    流程共 9 步：需求定向(1-3) → 方案设计(4-6) → 交付沉淀(7-9)
                  </p>
                  <p className="workflow-guidance-desc">
                    当前阶段：{STEP_META[activeStepNumber]?.phase}。你可以自然语言推进或回改步骤（如“回到第2步重做”）；跨步与回改都会先二次确认。
                  </p>
                </div>

                <div className="step-divider">
                  <div className="step-divider-line" />
                  <span className="step-divider-label">Step {activeStepNumber + 1}</span>
                  <span className="step-divider-title">{STEP_META[activeStepNumber]?.title}</span>
                  <span className={`step-divider-status ${workflowCompleted ? "" : "active"}`}>
                    <span className="dot" />
                    {workflowCompleted ? "完成" : "进行中"}
                  </span>
                  <div className="step-divider-line" />
                </div>

                <div className="conversation-meta-strip">
                  <span>全流程 {conversationInsight.roundCount} 轮 / {conversationInsight.messageCount} 条消息</span>
                  <span>
                    当前 Step {activeStepNumber + 1}：{conversationInsight.currentStepRoundCount} 轮 / {conversationInsight.currentStepMessageCount} 条
                  </span>
                  {conversationInsight.lastUserText ? (
                    <span>上轮输入：{conversationInsight.lastUserText}</span>
                  ) : null}
                  {conversationInsight.prevUserText ? (
                    <span>上上轮输入：{conversationInsight.prevUserText}</span>
                  ) : null}
                  {stepsLoading ? <span>步骤信息加载中...</span> : null}
                  {stepsError ? <span>步骤信息加载失败，已降级为基础模式</span> : null}
                </div>

                {activeStep?.output?.text && !(conversation ?? []).some(
                  (item) => item.role === "assistant" && item.stepNumber === activeStepNumber
                ) ? (
                  <div className="message agent">
                    <div className="message-header">
                      <div className="message-avatar agent">P</div>
                      <span className="message-sender">ProductFlow</span>
                      <span className="message-step-tag">Step {activeStepNumber + 1}</span>
                      <span className="message-time">{formatDate(activeStep.updatedAt)}</span>
                    </div>
                    <div className={`message-body ${showStepOutputQuestionnaire ? "questionnaire-shell" : "prose prose-sm max-w-none"}`}>
                      {showStepOutputQuestionnaire ? (
                        renderQuestionnaireCard()
                      ) : (
                        <Streamdown>{normalizeMarkdownContent(String(activeStep.output.text))}</Streamdown>
                      )}
                    </div>
                  </div>
                ) : null}

                {inlineArtifacts.length > 0 ? (
                  <div className="asset-inline-note-group">
                    {inlineArtifacts.map((artifact) => (
                      <p key={artifact.id} className="asset-inline-note">
                        已生成文档：
                        <button
                          type="button"
                          className="pf-inline-link pf-inline-link-btn"
                          onClick={() => {
                            openAssetPreview({ kind: "artifact", id: artifact.id });
                            setAssetPanelCollapsed(false);
                          }}
                        >
                          {artifact.title}
                        </button>
                        <span className="asset-inline-meta">
                          {formatDate(artifact.createdAt)}
                        </span>
                      </p>
                    ))}
                  </div>
                ) : null}

                {conversation && conversation.length > 0 ? (
                  conversation.map((message, index) => {
                    const isQuestionnaireMessage = message.role === "assistant"
                      && questionnaireMessageId === message.id;
                    const showStepMarker = index === 0
                      || conversation[index - 1]?.stepNumber !== message.stepNumber;
                    const stepTitle = STEP_META[message.stepNumber]?.title ?? "步骤";

                    return (
                      <Fragment key={message.id}>
                        {showStepMarker ? (
                          <div className="timeline-step-marker">
                            <span className="timeline-step-chip">Step {message.stepNumber + 1}</span>
                            <span className="timeline-step-name">{stepTitle}</span>
                          </div>
                        ) : null}

                        {message.role === "system" ? (
                          <div className="timeline-system-event">
                            <span>{message.content}</span>
                          </div>
                        ) : (
                          <div className={`message ${message.role === "user" ? "user" : "agent"}`}>
                            <div className="message-header">
                              <div className={`message-avatar ${message.role === "user" ? "user" : "agent"}`}>
                                {message.role === "user" ? "你" : "P"}
                              </div>
                              <span className="message-sender">{message.role === "user" ? "你" : "ProductFlow"}</span>
                              <span className="message-step-tag">Step {message.stepNumber + 1}</span>
                              <span className="message-time">{formatDate(message.createdAt)}</span>
                            </div>
                            {message.role === "assistant" ? (
                              <div className={`message-body ${isQuestionnaireMessage ? "questionnaire-shell" : "prose prose-sm max-w-none"}`}>
                                {isQuestionnaireMessage ? (
                                  renderQuestionnaireCard()
                                ) : (
                                  <Streamdown>{normalizeMarkdownContent(message.content)}</Streamdown>
                                )}
                              </div>
                            ) : (
                              <div className="message-body user-message">
                                <p>{message.content}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </Fragment>
                    );
                  })
                ) : !activeStep?.output?.text ? (
                  <div className="message agent">
                    <div className="message-header">
                      <div className="message-avatar agent">P</div>
                      <span className="message-sender">ProductFlow</span>
                    </div>
                    <div className="message-body">
                      <p>还没有对话记录。先输入你的需求或修改意见开始当前步骤。</p>
                    </div>
                  </div>
                ) : null}

                {isExecuting ? (
                  <div className="thinking">
                    <div className="thinking-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                    <span className="thinking-text">正在思考与更新中...</span>
                  </div>
                ) : null}
              </section>
            </div>
          </div>

          <div className="input-area">
            <div className="command-hint">
              <Command className="h-3.5 w-3.5" />
              <span>自然语言推进：</span>
              {STEP_COMMAND_HINTS.map((hint, index) => (
                <code key={hint}>
                  {hint}
                  {index < STEP_COMMAND_HINTS.length - 1 ? " / " : ""}
                </code>
              ))}
            </div>

            {commandNotice ? (
              <div className={`command-notice ${commandNoticeTone}`}>
                <ArrowRight className="h-3.5 w-3.5" />
                <span>{commandNotice}</span>
              </div>
            ) : null}

            <div className="input-container">
              <textarea
                className="input-box"
                value={userMessage}
                onChange={(event) => setUserMessage(event.target.value)}
                onKeyDown={handleMessageKeyDown}
                placeholder={
                  activeStepNumber === 0 && !project.rawRequirement.trim()
                    ? "先输入原始需求，例如：我要做一个..."
                    : "输入你的想法、修改意见，或直接说“进入下一步”..."
                }
                rows={3}
              />
              <div className="input-actions">
                <button
                  className="input-btn"
                  title="附件"
                  type="button"
                  onClick={() => openUploadDialog("project")}
                  disabled={uploadAssetMutation.isPending}
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <button
                  className="input-btn send"
                  title="发送"
                  type="button"
                  onClick={() => {
                    void handleSendMessage();
                  }}
                  disabled={isExecuting}
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="input-hint">Enter 发送 · Shift+Enter 换行</div>
          </div>
        </div>

        <aside className={`asset-panel ${assetPanelCollapsed ? "collapsed" : ""}`}>
          <div className="asset-panel-header">
            <span className="asset-panel-title">项目资产</span>
            <button type="button" className="asset-panel-close" onClick={() => setAssetPanelCollapsed(true)}>
              ×
            </button>
          </div>
          <div className="asset-panel-content">
            <div className="asset-group">
              <div className="asset-group-header">
                <div className="asset-group-label">
                  <History className="h-3.5 w-3.5" />
                  文件版本历史
                </div>
                <span className="asset-group-count">{activeHistoryItems.length}</span>
              </div>
              {activeHistoryItems.length > 0 ? (
                activeHistoryItems.map((item) => (
                  <div
                    key={item.key}
                    className={`asset-item ${previewTarget?.kind === item.kind && previewTarget.id === item.id ? "active" : ""}`}
                    onClick={() => handleHistoryItemPreview(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        handleHistoryItemPreview(item);
                      }
                    }}
                  >
                    <div className={`asset-item-icon ${item.kind === "artifact" ? "asset-item-icon-doc" : "asset-item-icon-upload"}`}>
                      {item.kind === "artifact" ? "📄" : "📎"}
                    </div>
                    <div className="asset-item-info">
                      <div className="asset-item-name">{item.title}</div>
                      <div className="asset-item-detail">{item.subtitle}</div>
                    </div>
                    <span className="asset-item-badge">{item.latestLabel}</span>
                    <button
                      type="button"
                      className="asset-item-action"
                      title="归档"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleAssetArchived(item.kind, item.id);
                      }}
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="asset-history-empty">当前还没有可展示的文件资产。</div>
              )}
            </div>

            <div className="asset-group archived">
              <div className="asset-group-header">
                <div className="asset-group-label">
                  <ArchiveRestore className="h-3.5 w-3.5" />
                  已归档
                </div>
                <span className="asset-group-count">{archivedHistoryItems.length}</span>
              </div>
              {archivedHistoryItems.length > 0 ? (
                archivedHistoryItems.map((item) => (
                  <div
                    key={item.key}
                    className={`asset-item archived ${previewTarget?.kind === item.kind && previewTarget.id === item.id ? "active" : ""}`}
                    onClick={() => handleHistoryItemPreview(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        handleHistoryItemPreview(item);
                      }
                    }}
                  >
                    <div className={`asset-item-icon ${item.kind === "artifact" ? "asset-item-icon-doc" : "asset-item-icon-upload"}`}>
                      {item.kind === "artifact" ? "📄" : "📎"}
                    </div>
                    <div className="asset-item-info">
                      <div className="asset-item-name">{item.title}</div>
                      <div className="asset-item-detail">{item.subtitle}</div>
                    </div>
                    <span className="asset-item-badge">归档</span>
                    <button
                      type="button"
                      className="asset-item-action"
                      title="恢复"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleAssetArchived(item.kind, item.id);
                      }}
                    >
                      <ArchiveRestore className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="asset-history-empty">暂无归档内容。</div>
              )}
            </div>

            {canLoadMoreAssets ? (
              <button
                type="button"
                className="asset-load-more"
                onClick={() => setAssetHistoryLimit((prev) => prev + 120)}
              >
                加载更多文件历史
              </button>
            ) : null}
          </div>
        </aside>
      </div>

      <Dialog open={assetPreviewModalOpen} onOpenChange={setAssetPreviewModalOpen}>
        <DialogContent className="pf-asset-preview-dialog sm:max-w-4xl">
          {previewArtifact ? (
            <>
              <DialogHeader>
                <DialogTitle>{previewArtifact.title}</DialogTitle>
                <DialogDescription>
                  {previewArtifact.artifactType} · {formatDate(previewArtifact.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <div className="pf-asset-preview-markdown prose prose-sm max-w-none">
                <Streamdown>{normalizeMarkdownContent(String(previewArtifact.content || ""))}</Streamdown>
              </div>
            </>
          ) : previewUpload ? (
            <>
              <DialogHeader>
                <DialogTitle>{previewUpload.fileName}</DialogTitle>
                <DialogDescription>
                  {previewUpload.scope} · {formatDate(previewUpload.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <div className="pf-asset-preview-pane">
                {previewUpload.url && isImageMime(previewUpload.mimeType) ? (
                  <img
                    src={previewUpload.url}
                    alt={previewUpload.fileName}
                    className="pf-asset-preview-image"
                  />
                ) : null}

                {previewUpload.url && isPdfMime(previewUpload.mimeType) ? (
                  <iframe
                    src={previewUpload.url}
                    title={previewUpload.fileName}
                    className="pf-asset-preview-iframe"
                  />
                ) : null}

                {!previewUpload.url ||
                (!isImageMime(previewUpload.mimeType) && !isPdfMime(previewUpload.mimeType)) ? (
                  <div className="pf-asset-preview-meta">
                    <p>类型：{previewUpload.assetType}</p>
                    <p>MIME：{previewUpload.mimeType}</p>
                    <p>
                      大小：
                      {typeof previewUpload.fileSize === "number"
                        ? `${(previewUpload.fileSize / 1024).toFixed(1)} KB`
                        : "未知"}
                    </p>
                    <p>
                      作用域：{previewUpload.scope}
                      {typeof previewUpload.stepNumber === "number"
                        ? ` · Step ${previewUpload.stepNumber + 1}`
                        : ""}
                    </p>
                    {previewUpload.url ? (
                      <a href={previewUpload.url} target="_blank" rel="noreferrer" className="pf-inline-link">
                        在新窗口打开原文件
                      </a>
                    ) : (
                      <p>当前文件暂不支持站内预览。</p>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>预览不可用</DialogTitle>
                <DialogDescription>请先从资产列表选择一个文件资产。</DialogDescription>
              </DialogHeader>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
