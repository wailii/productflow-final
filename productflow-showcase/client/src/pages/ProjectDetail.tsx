import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  LayoutPanelTop,
  Loader2,
  Paperclip,
  Send,
  Settings2,
} from "lucide-react";
import {
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

type QuestionnaireInputType = "text" | "single" | "multi";

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

  return null;
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
  const optionCue = /(可选|选项|模式|形式|支持哪些|多选|勾选|例如|请描述)/;

  const normalizedLines = block.lines
    .map((line) => stripMarkdown(line).replace(/\s+/g, " ").trim())
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
    const headingPrompt = stripMarkdown(block.heading)
      .replace(/^第?\d{1,2}[章节步]?[：:\s-]*/, "")
      .trim();
    if (headingPrompt && (questionLike.test(headingPrompt) || normalizedLines.some((line) => parseOptionLine(line)))) {
      prompt = headingPrompt;
    }
  }

  if (!prompt || prompt.length < 4 || prompt.length > 180) return null;

  const hintParts: string[] = [];
  const cleanedHeading = stripMarkdown(block.heading).trim();
  if (cleanedHeading && cleanedHeading !== prompt) {
    hintParts.push(cleanedHeading);
  }

  normalizedLines
    .filter((line) => line !== prompt && /例如[:：]/.test(line) && !parseOptionLine(line))
    .forEach((line) => hintParts.push(line));

  const optionLines = promptIndex >= 0 ? normalizedLines.slice(promptIndex + 1) : normalizedLines;
  const rawOptions = optionLines
    .map((line) => parseOptionLine(line))
    .filter((item): item is ParsedOption => Boolean(item));

  const hasStrongOptionMarker = rawOptions.some((option) => option.kind !== "bullet");
  const allowBulletOption = hasStrongOptionMarker || optionCue.test(prompt);

  const seenOption = new Set<string>();
  const options: QuestionnaireOption[] = [];
  rawOptions.forEach((option) => {
    if (option.kind === "bullet" && !allowBulletOption) return;

    const label = stripMarkdown(option.label).replace(/\s+/g, " ").trim();
    if (!label || label.length > 180 || seenOption.has(label)) return;

    seenOption.add(label);
    options.push({
      id: `q${fieldIndex + 1}-o${options.length + 1}`,
      label,
      isOther: /(其他|其它|补充|自定义|请描述)/.test(label),
    });
  });

  let inputType: QuestionnaireInputType = "text";
  if (options.length > 0) {
    const hasCheckbox = rawOptions.some((option) => option.kind === "checkbox");
    const shouldUseMulti = hasCheckbox || /(可多选|多选|勾选|支持哪些|包括哪些)/.test(prompt);
    inputType = shouldUseMulti ? "multi" : "single";
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

    const cleaned = stripMarkdown(matched)
      .replace(/[：:]\s*$/, "")
      .trim();

    if (cleaned.length < 6 || cleaned.length > 160) continue;
    if (!questionLike.test(cleaned)) continue;
    candidates.push(cleaned);
  }

  return Array.from(new Set(candidates))
    .slice(0, 12)
    .map((prompt, index) => ({
      id: `q${index + 1}`,
      prompt,
      hint: "",
      inputType: "text" as QuestionnaireInputType,
      options: [],
    }));
}

function parseQuestionnaire(markdown: string | null | undefined): ParsedQuestionnaire | null {
  const normalized = normalizeMarkdownContent(String(markdown ?? ""));
  if (!normalized) return null;

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const questionCues = /(问卷|澄清|请回答|请补充|问题清单|请确认|请提供)/;
  const directQuestionLine = /([？?]|^(请|是否|能否|可否|为什么|如何|哪些|什么))/;

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
      .join("；");
    const noteText = answer.note.trim();
    const freeText = answer.text.trim();
    const answerParts = [optionText, freeText, noteText ? `补充：${noteText}` : ""].filter(Boolean);

    if (answerParts.length === 0) return;
    answered += 1;
    lines.push(`${index + 1}. ${question.prompt}`);
    lines.push(`答：${answerParts.join("\n")}`);
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

  const [userMessage, setUserMessage] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  const [uploadScope, setUploadScope] = useState<"project" | "step">("project");
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const [assetPanelCollapsed, setAssetPanelCollapsed] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget>(null);
  const [assetPreviewModalOpen, setAssetPreviewModalOpen] = useState(false);
  const [questionnaireAnswers, setQuestionnaireAnswers] = useState<Record<string, QuestionnaireAnswer>>({});

  const conversationScrollRef = useRef<HTMLDivElement>(null);
  const sendLockRef = useRef(false);
  const pendingConversationSizeRef = useRef(0);

  const { data: project, isLoading: projectLoading, refetch: refetchProject } =
    trpc.projects.get.useQuery({ projectId });
  const { data: steps, isLoading: stepsLoading, refetch: refetchSteps } =
    trpc.workflow.getSteps.useQuery({ projectId });

  const activeStepNumber = Math.min(project?.currentStep ?? 0, 8);
  const workflowCompleted = (project?.currentStep ?? 0) >= 9;

  const { data: conversation, refetch: refetchConversation } = trpc.workflow.getConversation.useQuery(
    { projectId, stepNumber: activeStepNumber },
    { enabled: !!project && activeStepNumber >= 0 && activeStepNumber <= 8 }
  );

  const { data: artifactsData, refetch: refetchArtifacts } = trpc.workflow.getArtifacts.useQuery(
    { projectId, stepNumber: activeStepNumber, limit: 200 },
    { enabled: !!project && activeStepNumber >= 0 && activeStepNumber <= 8 }
  );
  const { data: uploadedAssetsData, refetch: refetchUploadedAssets } = trpc.workflow.getAssets.useQuery(
    { projectId, stepNumber: activeStepNumber, limit: 120 },
    { enabled: !!project && activeStepNumber >= 0 && activeStepNumber <= 8 }
  );

  const continueConversationMutation = trpc.workflow.continueConversation.useMutation();
  const uploadAssetMutation = trpc.workflow.uploadAsset.useMutation();

  const artifacts = artifactsData?.items ?? [];
  const uploadedAssets = uploadedAssetsData?.items ?? [];

  const completedStepCount = useMemo(
    () => (steps ?? []).filter((step) => step.status === "completed").length,
    [steps]
  );

  const progressPercent = Math.round((completedStepCount / 9) * 100);

  const visibleArtifacts = useMemo(() => {
    const filtered = artifacts.filter(
      (item) =>
        USER_VISIBLE_ARTIFACT_TYPES.has(item.artifactType) &&
        (item.source === "agent" || item.source === "system")
    );
    const dedup = new Map<string, (typeof filtered)[number]>();

    for (const artifact of filtered) {
      const key = `${artifact.artifactType}:${artifact.title}`;
      if (!dedup.has(key)) {
        dedup.set(key, artifact);
      }
    }

    return Array.from(dedup.values());
  }, [artifacts]);

  const inlineArtifacts = useMemo(
    () => visibleArtifacts.filter((item) => item.artifactType !== "step_input").slice(0, 3),
    [visibleArtifacts]
  );

  const previewArtifact =
    previewTarget?.kind === "artifact"
      ? visibleArtifacts.find((item) => item.id === previewTarget.id) ?? null
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
      if (history[i]?.role === "assistant") {
        return history[i];
      }
    }
    return null;
  }, [conversation]);

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

  useEffect(() => {
    if (visibleArtifacts.length > 0) {
      setPreviewTarget((prev) => {
        if (prev?.kind === "artifact" && visibleArtifacts.some((item) => item.id === prev.id)) {
          return prev;
        }
        return { kind: "artifact", id: visibleArtifacts[0].id };
      });
      return;
    }

    if (uploadedAssets.length > 0) {
      setPreviewTarget((prev) => {
        if (prev?.kind === "upload" && uploadedAssets.some((item) => item.id === prev.id)) {
          return prev;
        }
        return { kind: "upload", id: uploadedAssets[0].id };
      });
      return;
    }

    setPreviewTarget(null);
  }, [visibleArtifacts, uploadedAssets]);

  useEffect(() => {
    const node = conversationScrollRef.current;
    if (!node) return;

    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [conversation?.length, isExecuting]);

  useEffect(() => {
    if (!activeQuestionnaire) {
      setQuestionnaireAnswers({});
      return;
    }

    setQuestionnaireAnswers((current) => {
      const next: Record<string, QuestionnaireAnswer> = {};
      activeQuestionnaire.questions.forEach((question) => {
        const previous = current[question.id] ?? createEmptyQuestionnaireAnswer();
        const validOptionIds = new Set(question.options.map((option) => option.id));
        next[question.id] = {
          text: previous.text,
          note: previous.note,
          selectedOptionIds: previous.selectedOptionIds.filter((optionId) => validOptionIds.has(optionId)),
        };
      });
      return next;
    });
  }, [activeQuestionnaire?.key]);

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
      toast.success("Agent 已完成新一轮打磨");
    } catch (error: any) {
      setUserMessage((current) => (current.trim() ? current : content));
      toast.error(error.message || "对话失败");
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
      const selectedOptionIds = question.inputType === "single"
        ? (checked ? [optionId] : [])
        : (
          checked
            ? Array.from(new Set([...previous.selectedOptionIds, optionId]))
            : previous.selectedOptionIds.filter((id) => id !== optionId)
        );

      return {
        ...current,
        [question.id]: {
          ...previous,
          selectedOptionIds,
        },
      };
    });
  };

  const handleSubmitQuestionnaire = async () => {
    if (!activeQuestionnaire || sendLockRef.current || isExecuting) return;

    const userReply = buildQuestionnaireReply(activeQuestionnaire, questionnaireAnswers);
    if (!userReply) {
      toast.error("请先填写至少一个问题");
      return;
    }

    await handleContinueConversation(userReply);
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

    return (
      <div className="questionnaire-card">
        <div className="questionnaire-header">
          <h3>{activeQuestionnaire.title}</h3>
          <p>直接勾选选项并补充说明，提交后系统会自动整理成结构化回复。</p>
        </div>

        <div className="questionnaire-fields">
          {activeQuestionnaire.questions.map((question, index) => {
            const answer = questionnaireAnswers[question.id] ?? createEmptyQuestionnaireAnswer();
            const selectedOptionIds = new Set(answer.selectedOptionIds);
            const showNoteInput = question.options.some(
              (option) => option.isOther && selectedOptionIds.has(option.id)
            );

            return (
              <div key={question.id} className="questionnaire-field">
                <span className="questionnaire-label">
                  {index + 1}. {question.prompt}
                </span>
                {question.hint ? (
                  <span className="questionnaire-hint">{question.hint}</span>
                ) : null}

                {question.options.length > 0 ? (
                  <div className={`questionnaire-options ${question.inputType}`}>
                    {question.options.map((option) => (
                      <label
                        key={option.id}
                        className={`questionnaire-option ${selectedOptionIds.has(option.id) ? "active" : ""}`}
                      >
                        <input
                          type={question.inputType === "single" ? "radio" : "checkbox"}
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

  if (projectLoading || stepsLoading) {
    return (
      <div className="pf-page flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--pf-text-secondary)]" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="pf-page flex min-h-screen items-center justify-center px-4">
        <div className="pf-side-card max-w-lg">
          <h3>项目不存在</h3>
          <p>该项目可能已删除或你没有访问权限。</p>
          <div className="pf-side-buttons">
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
            当前 Step {activeStepNumber + 1}/9
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
                    当前 Step {activeStepNumber + 1}/9 · {STEP_META[activeStepNumber]?.title}。如果需要修改前序步骤，直接在当前对话里提出变更即可，无需手动回跳步骤。
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

                {activeStep?.output?.text && !(conversation ?? []).some((item) => item.role === "assistant") ? (
                  <div className="message agent">
                    <div className="message-header">
                      <div className="message-avatar agent">P</div>
                      <span className="message-sender">ProductFlow</span>
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

                {inlineArtifacts.map((artifact) => (
                  <div
                    key={artifact.id}
                    className="asset-card-inline"
                    role="button"
                    tabIndex={0}
                    data-asset={artifact.id}
                    onClick={() => {
                      openAssetPreview({ kind: "artifact", id: artifact.id });
                      setAssetPanelCollapsed(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        openAssetPreview({ kind: "artifact", id: artifact.id });
                        setAssetPanelCollapsed(false);
                      }
                    }}
                  >
                    <div className="asset-icon doc">📄</div>
                    <div className="asset-card-info">
                      <div className="asset-card-name">{artifact.title}</div>
                      <div className="asset-card-meta">
                        {artifact.artifactType} · {formatDate(artifact.createdAt)}
                      </div>
                    </div>
                    <span className="asset-card-arrow">→</span>
                  </div>
                ))}

                {conversation && conversation.length > 0 ? (
                  conversation.map((message) => {
                    const isQuestionnaireMessage = message.role === "assistant"
                      && questionnaireMessageId === message.id;

                    return (
                      <div key={message.id} className={`message ${message.role === "user" ? "user" : "agent"}`}>
                        <div className="message-header">
                          <div className={`message-avatar ${message.role === "user" ? "user" : "agent"}`}>
                            {message.role === "user" ? "你" : "P"}
                          </div>
                          <span className="message-sender">{message.role === "user" ? "你" : "ProductFlow"}</span>
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
                          <div className="message-body">
                            <p>{message.content}</p>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="message agent">
                    <div className="message-header">
                      <div className="message-avatar agent">P</div>
                      <span className="message-sender">ProductFlow</span>
                    </div>
                    <div className="message-body">
                      <p>还没有对话记录。先输入你的需求或修改意见开始当前步骤。</p>
                    </div>
                  </div>
                )}

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
            <div className="input-container">
              <textarea
                className="input-box"
                value={userMessage}
                onChange={(event) => setUserMessage(event.target.value)}
                onKeyDown={handleMessageKeyDown}
                placeholder={
                  activeStepNumber === 0 && !project.rawRequirement.trim()
                    ? "先输入原始需求，例如：我要做一个..."
                    : "输入你的想法或修改意见..."
                }
                rows={5}
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
            <button className="asset-panel-close" onClick={() => setAssetPanelCollapsed(true)}>
              ×
            </button>
          </div>
          <div className="asset-panel-content">
            <div className="asset-group">
              <div className="asset-group-label">Agent 输出文档</div>
              {visibleArtifacts.length > 0 ? (
                visibleArtifacts.map((artifact) => (
                  <div
                    key={artifact.id}
                    className={`asset-item ${previewTarget?.kind === "artifact" && previewTarget.id === artifact.id ? "active" : ""}`}
                    onClick={() => openAssetPreview({ kind: "artifact", id: artifact.id })}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") openAssetPreview({ kind: "artifact", id: artifact.id });
                    }}
                  >
                    <div className="asset-item-icon" style={{ background: "#eef2ff", color: "#4f46e5" }}>📄</div>
                    <div className="asset-item-info">
                      <div className="asset-item-name">{artifact.title}</div>
                      <div className="asset-item-detail">{artifact.artifactType} · {formatDate(artifact.createdAt)}</div>
                    </div>
                    <span className="asset-item-badge">最新</span>
                  </div>
                ))
              ) : (
                <div className="asset-item-detail">当前步骤还没有可展示资产。</div>
              )}
            </div>

            <div className="asset-group">
              <div className="asset-group-label">用户上传</div>
              {uploadedAssets.length > 0 ? (
                uploadedAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className={`asset-item ${previewTarget?.kind === "upload" && previewTarget.id === asset.id ? "active" : ""}`}
                    onClick={() => openAssetPreview({ kind: "upload", id: asset.id })}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") openAssetPreview({ kind: "upload", id: asset.id });
                    }}
                  >
                    <div className="asset-item-icon" style={{ background: "#f3f4f6", color: "#6b7280" }}>📎</div>
                    <div className="asset-item-info">
                      <div className="asset-item-name">{asset.fileName}</div>
                      <div className="asset-item-detail">
                        {asset.scope} · {typeof asset.fileSize === "number" ? `${(asset.fileSize / 1024).toFixed(1)} KB` : "大小未知"}
                      </div>
                    </div>
                    <span className="asset-item-badge">资料</span>
                  </div>
                ))
              ) : (
                <div className="asset-item-detail">暂未上传资料。</div>
              )}
            </div>

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
                <DialogDescription>请先从资产列表选择一个文档或上传文件。</DialogDescription>
              </DialogHeader>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
