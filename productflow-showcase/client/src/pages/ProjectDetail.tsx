import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Database,
  FileText,
  GitBranch,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  SkipForward,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
];

const PHASES = [
  { name: "需求定向", stepNumbers: [0, 1, 2] },
  { name: "方案设计", stepNumbers: [3, 4, 5] },
  { name: "交付沉淀", stepNumbers: [6, 7, 8] },
];

const CHAT_QUICK_PROMPTS = [
  "请列出当前输出里最重要的3个风险点，并给出修复方案。",
  "请把当前结果改成可直接评审的 checklist 格式。",
  "请指出和前序步骤可能冲突的地方，并给出合并建议。",
];

type PanelTab = "output" | "chat" | "artifacts" | "trace";

type ChangeAnalysis = {
  intentType: string;
  recommendedStartStep: number;
  impactedSteps: number[];
  reason: string;
  risks: string[];
  conflicts: string[];
  actionPlan: string[];
  summary: string;
};

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

export default function ProjectDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = Number.parseInt(params.id || "0", 10);

  const [selectedStepNumber, setSelectedStepNumber] = useState(0);
  const [activeTab, setActiveTab] = useState<PanelTab>("output");
  const [userMessage, setUserMessage] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [changeRequest, setChangeRequest] = useState("");
  const [changeAnalysis, setChangeAnalysis] = useState<ChangeAnalysis | null>(null);
  const [uploadScope, setUploadScope] = useState<"project" | "step">("project");
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const { data: project, isLoading: projectLoading, refetch: refetchProject } =
    trpc.projects.get.useQuery({ projectId });
  const { data: steps, isLoading: stepsLoading, refetch: refetchSteps } =
    trpc.workflow.getSteps.useQuery({ projectId });

  const { data: conversation, refetch: refetchConversation } = trpc.workflow.getConversation.useQuery(
    { projectId, stepNumber: selectedStepNumber },
    { enabled: !!project && selectedStepNumber >= 0 && selectedStepNumber <= 8 }
  );

  const { data: agentTrace, refetch: refetchAgentTrace } = trpc.workflow.getAgentTrace.useQuery(
    { projectId, stepNumber: selectedStepNumber },
    { enabled: !!project && selectedStepNumber >= 0 && selectedStepNumber <= 8 }
  );

  const { data: artifactsData, refetch: refetchArtifacts } = trpc.workflow.getArtifacts.useQuery(
    { projectId, stepNumber: selectedStepNumber, limit: 200 },
    { enabled: !!project && selectedStepNumber >= 0 && selectedStepNumber <= 8 }
  );
  const { data: uploadedAssetsData, refetch: refetchUploadedAssets } = trpc.workflow.getAssets.useQuery(
    { projectId, stepNumber: selectedStepNumber, limit: 120 },
    { enabled: !!project && selectedStepNumber >= 0 && selectedStepNumber <= 8 }
  );

  const executeStepMutation = trpc.workflow.executeStep.useMutation();
  const continueConversationMutation = trpc.workflow.continueConversation.useMutation();
  const confirmStepMutation = trpc.workflow.confirmStep.useMutation();
  const skipStepMutation = trpc.workflow.skipStep.useMutation();
  const analyzeChangeMutation = trpc.workflow.analyzeChangeRequest.useMutation();
  const applyChangeMutation = trpc.workflow.applyChangePlan.useMutation();
  const uploadAssetMutation = trpc.workflow.uploadAsset.useMutation();

  const currentStepNumber = Math.min(project?.currentStep ?? 0, 8);
  const workflowCompleted = (project?.currentStep ?? 0) >= 9;
  const selectedStep = steps?.find((step) => step.stepNumber === selectedStepNumber) ?? null;

  const completedStepCount = useMemo(
    () => (steps ?? []).filter((step) => step.status === "completed").length,
    [steps]
  );

  const artifacts = artifactsData?.items ?? [];
  const uploadedAssets = uploadedAssetsData?.items ?? [];
  const artifactStats = useMemo(() => {
    const stats = new Map<string, number>();
    for (const item of artifacts) {
      stats.set(item.artifactType, (stats.get(item.artifactType) ?? 0) + 1);
    }
    return Array.from(stats.entries()).sort((a, b) => b[1] - a[1]);
  }, [artifacts]);

  const progress = Math.round((completedStepCount / 9) * 100);
  const selectedIsCurrent = !workflowCompleted && selectedStepNumber === currentStepNumber;
  const selectedAheadOfCurrent = !workflowCompleted && selectedStepNumber > currentStepNumber;

  useEffect(() => {
    if (!project) return;
    setSelectedStepNumber(Math.min(project.currentStep, 8));
  }, [project?.id]);

  const refetchAllForSelected = async () => {
    await Promise.all([
      refetchProject(),
      refetchSteps(),
      refetchConversation(),
      refetchAgentTrace(),
      refetchArtifacts(),
      refetchUploadedAssets(),
    ]);
  };

  const handleExecuteStep = async () => {
    if (!project) return;
    if (selectedAheadOfCurrent) {
      toast.error("请先完成前置步骤");
      return;
    }

    setIsExecuting(true);
    try {
      await executeStepMutation.mutateAsync({
        projectId: project.id,
        stepNumber: selectedStepNumber,
      });
      await refetchAllForSelected();
      setActiveTab("trace");
      toast.success(`Step ${selectedStepNumber + 1} 执行完成`);
    } catch (error: any) {
      toast.error(error.message || "执行失败");
    } finally {
      setIsExecuting(false);
    }
  };

  const handleContinueConversation = async () => {
    if (!project || !userMessage.trim()) return;

    setIsExecuting(true);
    try {
      await continueConversationMutation.mutateAsync({
        projectId: project.id,
        stepNumber: selectedStepNumber,
        userMessage: userMessage.trim(),
      });
      setUserMessage("");
      await refetchAllForSelected();
      setActiveTab("chat");
      toast.success("Agent 已完成新一轮打磨");
    } catch (error: any) {
      toast.error(error.message || "对话失败");
    } finally {
      setIsExecuting(false);
    }
  };

  const handleMessageKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleContinueConversation();
    }
  };

  const handleConfirmCurrentStep = async () => {
    if (!project || !selectedIsCurrent) return;

    try {
      const result = await confirmStepMutation.mutateAsync({
        projectId: project.id,
        stepNumber: selectedStepNumber,
      });
      await refetchProject();
      await refetchSteps();

      const nextStep = Math.min(result.nextStep, 8);
      setSelectedStepNumber(nextStep);
      await Promise.all([
        refetchConversation(),
        refetchAgentTrace(),
        refetchArtifacts(),
        refetchUploadedAssets(),
      ]);
      toast.success(
        result.nextStep >= 9
          ? "恭喜，9 个步骤已全部完成"
          : `已进入 Step ${result.nextStep + 1}`
      );
    } catch (error: any) {
      toast.error(error.message || "确认失败");
    }
  };

  const handleSkipCurrentStep = async () => {
    if (!project || !selectedIsCurrent) return;

    try {
      await skipStepMutation.mutateAsync({
        projectId: project.id,
        stepNumber: selectedStepNumber,
      });
      await refetchProject();
      await refetchSteps();
      const nextStep = Math.min((project.currentStep ?? 0) + 1, 8);
      setSelectedStepNumber(nextStep);
      await Promise.all([
        refetchConversation(),
        refetchAgentTrace(),
        refetchArtifacts(),
        refetchUploadedAssets(),
      ]);
      toast.success("已跳过当前步骤");
    } catch (error: any) {
      toast.error(error.message || "跳过失败");
    }
  };

  const handleAnalyzeChangeRequest = async () => {
    if (!project || !changeRequest.trim()) {
      toast.error("请先输入变更诉求");
      return;
    }

    try {
      const result = await analyzeChangeMutation.mutateAsync({
        projectId: project.id,
        changeRequest: changeRequest.trim(),
      });
      setChangeAnalysis(result);
      toast.success(`已完成分析：建议从 Step ${result.recommendedStartStep + 1} 继续`);
    } catch (error: any) {
      toast.error(error.message || "变更分析失败");
    }
  };

  const handleApplyChangePlan = async () => {
    if (!project || !changeAnalysis) return;

    try {
      await applyChangeMutation.mutateAsync({
        projectId: project.id,
        startStep: changeAnalysis.recommendedStartStep,
        changeRequest: changeRequest.trim() || undefined,
      });

      setSelectedStepNumber(changeAnalysis.recommendedStartStep);
      await refetchAllForSelected();
      toast.success(`已切换到 Step ${changeAnalysis.recommendedStartStep + 1} 重新迭代`);
    } catch (error: any) {
      toast.error(error.message || "应用迭代计划失败");
    }
  };

  const openUploadDialog = (scope: "project" | "step") => {
    setUploadScope(scope);
    uploadInputRef.current?.click();
  };

  const handleAssetUpload: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
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
        const assetType =
          mimeType.startsWith("image/")
            ? "image"
            : mimeType.includes("pdf") || mimeType.startsWith("text/") || mimeType.includes("officedocument")
            ? "document"
            : "other";

        await uploadAssetMutation.mutateAsync({
          projectId: project.id,
          stepNumber: uploadScope === "step" ? selectedStepNumber : undefined,
          scope: uploadScope,
          assetType,
          fileName: file.name,
          mimeType,
          base64Data,
        });
      }

      await refetchAllForSelected();
      setActiveTab("artifacts");
      toast.success("资产上传完成");
    } catch (error: any) {
      toast.error(error.message || "上传失败");
    } finally {
      event.target.value = "";
    }
  };

  if (projectLoading || stepsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,oklch(0.98_0.01_250),oklch(0.97_0.015_240)_45%,oklch(0.98_0.01_85))]">
        <Loader2 className="h-8 w-8 animate-spin text-[oklch(0.5_0.05_240)]" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,oklch(0.98_0.01_250),oklch(0.97_0.015_240)_45%,oklch(0.98_0.01_85))]">
        <Card className="w-full max-w-md border-[oklch(0.84_0.03_242)] bg-white/90">
          <CardHeader>
            <CardTitle>项目不存在</CardTitle>
            <CardDescription>该项目可能已删除或您没有访问权限。</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setLocation("/")}>返回首页</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[linear-gradient(180deg,oklch(0.98_0.01_250),oklch(0.97_0.015_240)_45%,oklch(0.98_0.01_85))] text-[oklch(0.28_0.03_246)]">
      <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(to_right,oklch(0.72_0.03_244/.2)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.72_0.03_244/.2)_1px,transparent_1px)] [background-size:48px_48px]" />
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.xml,.yaml,.yml,.png,.jpg,.jpeg,.webp,.gif"
        onChange={handleAssetUpload}
      />

      <header className="sticky top-0 z-20 border-b border-[oklch(0.84_0.03_242)] bg-white/80 backdrop-blur-xl">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="hover:bg-[oklch(0.95_0.02_240)]"
              onClick={() => setLocation("/")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回项目列表
            </Button>
            <div>
              <h1 className="font-display text-2xl text-[oklch(0.25_0.04_246)]">{project.title}</h1>
              <p className="text-sm text-[oklch(0.43_0.03_242)]">
                {workflowCompleted
                  ? "全部流程已完成"
                  : `当前推进：Step ${currentStepNumber + 1} · ${STEP_META[currentStepNumber]?.title}`}
              </p>
            </div>
          </div>
          <Badge
            className={
              workflowCompleted
                ? "border border-emerald-600/25 bg-emerald-500/15 text-emerald-700"
                : "border border-[oklch(0.8_0.05_242)] bg-[oklch(0.94_0.03_240)] text-[oklch(0.33_0.05_242)]"
            }
          >
            {workflowCompleted ? "已完成" : "进行中"}
          </Badge>
        </div>
      </header>

      <main className="container relative py-6">
        <div className="grid gap-5 xl:grid-cols-[300px_1fr_340px]">
          <aside className="space-y-4">
            <Card className="border-[oklch(0.84_0.03_242)] bg-white/86 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base text-[oklch(0.27_0.04_246)]">执行总览</CardTitle>
                <CardDescription>完成 {completedStepCount}/9 · 进度 {progress}%</CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={progress} className="mb-4" />
                <div className="space-y-4">
                  {PHASES.map((phase) => (
                    <div key={phase.name}>
                      <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[oklch(0.48_0.03_242)]">
                        {phase.name}
                      </p>
                      <div className="space-y-1.5">
                        {phase.stepNumbers.map((stepNumber) => {
                          const step = steps?.find((item) => item.stepNumber === stepNumber);
                          const status = step?.status ?? "pending";
                          const selected = stepNumber === selectedStepNumber;
                          const isCurrent = !workflowCompleted && stepNumber === currentStepNumber;
                          return (
                            <button
                              key={stepNumber}
                              type="button"
                              onClick={() => {
                                setSelectedStepNumber(stepNumber);
                                setActiveTab("output");
                              }}
                              className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                                selected
                                  ? "border-[oklch(0.72_0.09_242)] bg-[oklch(0.95_0.03_240)]"
                                  : "border-[oklch(0.86_0.03_242)] bg-white/82 hover:border-[oklch(0.78_0.05_242)]"
                              }`}
                            >
                              <div className="flex h-5 w-5 items-center justify-center">
                                {status === "completed" ? (
                                  <Check className="h-4 w-4 text-emerald-500" />
                                ) : isCurrent ? (
                                  <CircleDot className="h-4 w-4 text-[oklch(0.54_0.13_240)]" />
                                ) : (
                                  <div className="h-2 w-2 rounded-full bg-[oklch(0.74_0.03_242)]" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-[oklch(0.29_0.04_246)]">
                                  Step {stepNumber + 1}
                                </p>
                                <p className="truncate text-xs text-[oklch(0.43_0.03_242)]">
                                  {STEP_META[stepNumber]?.title}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </aside>

          <section className="space-y-4">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <Card className="border-[oklch(0.84_0.03_242)] bg-white/88 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-[oklch(0.48_0.03_242)]">
                        {STEP_META[selectedStepNumber]?.phase}
                      </p>
                      <CardTitle className="mt-1 text-[oklch(0.26_0.04_246)]">
                        Step {selectedStepNumber + 1} · {STEP_META[selectedStepNumber]?.title}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {selectedAheadOfCurrent
                          ? "该步骤尚未解锁，需要先完成前置步骤。"
                          : selectedIsCurrent
                          ? "当前步骤可执行、可继续打磨，并确认进入下一步。"
                          : "这是历史步骤，可查看结果，也可重跑该步骤。"}
                      </CardDescription>
                    </div>
                    <Badge
                      className={
                        selectedStep?.status === "completed"
                          ? "border border-emerald-600/25 bg-emerald-500/15 text-emerald-700"
                          : "border border-[oklch(0.82_0.04_242)] bg-[oklch(0.94_0.03_240)] text-[oklch(0.34_0.05_242)]"
                      }
                    >
                      {selectedStep?.status === "completed" ? "已完成" : selectedStep?.status ?? "pending"}
                    </Badge>
                  </div>
                </CardHeader>
              </Card>
            </motion.div>

            <Card className="border-[oklch(0.84_0.03_242)] bg-white/88 shadow-sm">
              <CardContent className="p-5">
                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PanelTab)}>
                  <TabsList className="grid h-auto w-full grid-cols-4 rounded-xl border border-[oklch(0.85_0.03_242)] bg-[oklch(0.97_0.02_238)] p-1">
                    <TabsTrigger value="output" className="rounded-lg">
                      <Sparkles className="h-4 w-4" />
                      结果
                    </TabsTrigger>
                    <TabsTrigger value="chat" className="rounded-lg">
                      <MessageSquare className="h-4 w-4" />
                      对话
                    </TabsTrigger>
                    <TabsTrigger value="artifacts" className="rounded-lg">
                      <Database className="h-4 w-4" />
                      资产
                    </TabsTrigger>
                    <TabsTrigger value="trace" className="rounded-lg">
                      <Bot className="h-4 w-4" />
                      轨迹
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="output" className="mt-4">
                    {selectedStep?.output?.text ? (
                      <div className="rounded-2xl border border-[oklch(0.85_0.03_242)] bg-white p-4">
                        <div className="prose prose-sm max-w-none prose-headings:text-[oklch(0.28_0.04_246)] prose-p:text-[oklch(0.37_0.03_242)]">
                          <Streamdown>{String(selectedStep.output.text)}</Streamdown>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[oklch(0.84_0.03_242)] bg-[oklch(0.98_0.02_238)] p-10 text-center text-sm text-[oklch(0.44_0.03_242)]">
                        当前步骤还没有输出结果。点击右侧“运行 Agent”开始执行。
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="chat" className="mt-4 space-y-4">
                    <div className="rounded-2xl border border-[oklch(0.84_0.03_242)] bg-[linear-gradient(180deg,white,oklch(0.98_0.02_238))] p-3">
                      <div className="max-h-[390px] space-y-3 overflow-auto rounded-xl border border-[oklch(0.9_0.02_242)] bg-white/80 p-3">
                        {conversation && conversation.length > 0 ? (
                          conversation.map((msg) => (
                            <div
                              key={msg.id}
                              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[86%] rounded-2xl border px-3 py-2 text-sm ${
                                  msg.role === "user"
                                    ? "border-transparent bg-[linear-gradient(135deg,oklch(0.56_0.15_236),oklch(0.64_0.16_253))] text-white"
                                    : "border-[oklch(0.86_0.03_242)] bg-white text-[oklch(0.32_0.03_242)]"
                                }`}
                              >
                                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] opacity-70">
                                  <span>{msg.role === "user" ? "你" : msg.role === "assistant" ? "Agent" : "系统"}</span>
                                  <span>{formatDate(msg.createdAt)}</span>
                                </div>
                                <p className="whitespace-pre-wrap leading-6">{msg.content}</p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="p-4 text-sm text-[oklch(0.44_0.03_242)]">
                            还没有对话记录。先运行该步骤后再继续提问。
                          </p>
                        )}
                      </div>

                      <div className="mt-3 rounded-xl border border-[oklch(0.84_0.03_242)] bg-white px-3 py-2 text-xs text-[oklch(0.4_0.03_242)]">
                        当前步骤可用资料：{uploadedAssets.length} 个（文档/图片会自动纳入 Agent 上下文）
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {CHAT_QUICK_PROMPTS.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            className="rounded-full border border-[oklch(0.84_0.03_242)] bg-white px-3 py-1 text-xs text-[oklch(0.36_0.03_242)] hover:border-[oklch(0.74_0.08_242)]"
                            onClick={() => setUserMessage(prompt)}
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>

                      <div className="mt-3 space-y-2">
                        <Textarea
                          value={userMessage}
                          onChange={(event) => setUserMessage(event.target.value)}
                          onKeyDown={handleMessageKeyDown}
                          placeholder="输入你的修改意见（Ctrl/Cmd + Enter 发送）..."
                          className="min-h-[120px] border-[oklch(0.84_0.03_242)] bg-white"
                        />
                        <Button
                          onClick={handleContinueConversation}
                          disabled={isExecuting || !userMessage.trim() || selectedAheadOfCurrent}
                          className="w-full bg-[linear-gradient(135deg,oklch(0.56_0.15_236),oklch(0.64_0.16_253))] text-white hover:brightness-105"
                        >
                          {isExecuting ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Agent 回复中...
                            </>
                          ) : (
                            <>
                              <Send className="mr-2 h-4 w-4" />
                              发送并继续打磨
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="artifacts" className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-[oklch(0.82_0.05_242)] bg-white"
                        onClick={() => openUploadDialog("project")}
                        disabled={uploadAssetMutation.isPending}
                      >
                        {uploadAssetMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Database className="mr-2 h-4 w-4" />
                        )}
                        上传到项目资料库
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-[oklch(0.82_0.05_242)] bg-white"
                        onClick={() => openUploadDialog("step")}
                        disabled={uploadAssetMutation.isPending}
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        上传到当前步骤
                      </Button>
                      <span className="text-xs text-[oklch(0.44_0.03_242)]">
                        支持 PDF / Word / 文本 / 图片，单文件不超过 15MB
                      </span>
                    </div>

                    {uploadedAssets.length > 0 ? (
                      <div className="space-y-2 rounded-2xl border border-[oklch(0.84_0.03_242)] bg-white p-3">
                        <p className="text-sm font-medium text-[oklch(0.29_0.04_246)]">已上传资料</p>
                        <div className="max-h-[240px] space-y-2 overflow-auto">
                          {uploadedAssets.map((asset) => (
                            <div
                              key={asset.id}
                              className="rounded-xl border border-[oklch(0.86_0.03_242)] bg-[oklch(0.99_0.01_240)] p-3"
                            >
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="text-[11px]">
                                  {asset.assetType}
                                </Badge>
                                <Badge variant="outline" className="text-[11px]">
                                  {asset.scope}
                                </Badge>
                                <span className="text-[11px] text-[oklch(0.45_0.03_242)]">
                                  {formatDate(asset.createdAt)}
                                </span>
                              </div>
                              <p className="text-sm font-medium text-[oklch(0.29_0.04_246)]">{asset.fileName}</p>
                              <p className="text-xs text-[oklch(0.42_0.03_242)]">
                                {asset.mimeType} · {(asset.fileSize / 1024).toFixed(1)} KB
                              </p>
                              {asset.note ? (
                                <p className="mt-1 text-xs text-[oklch(0.42_0.03_242)]">{asset.note}</p>
                              ) : null}
                              {asset.url ? (
                                <a
                                  href={asset.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-block text-xs text-[oklch(0.52_0.14_240)] underline"
                                >
                                  打开预览
                                </a>
                              ) : (
                                <p className="mt-1 text-xs text-[oklch(0.45_0.03_242)]">预览地址不可用</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[oklch(0.84_0.03_242)] bg-[oklch(0.98_0.02_238)] p-6 text-center text-sm text-[oklch(0.44_0.03_242)]">
                        还没有上传资料。可先上传原始需求文档、原型截图、调研材料，再让 Agent 自动引用。
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {artifactStats.map(([type, count]) => (
                        <Badge key={type} variant="outline" className="bg-white text-xs">
                          {type} · {count}
                        </Badge>
                      ))}
                    </div>

                    {artifacts.length > 0 ? (
                      <div className="max-h-[420px] space-y-2 overflow-auto rounded-2xl border border-[oklch(0.84_0.03_242)] bg-white p-3">
                        {artifacts.map((artifact) => (
                          <div key={artifact.id} className="rounded-xl border border-[oklch(0.86_0.03_242)] bg-[oklch(0.99_0.01_240)] p-3">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="text-[11px]">
                                {artifact.artifactType}
                              </Badge>
                              {typeof artifact.iteration === "number" ? (
                                <Badge variant="outline" className="text-[11px]">
                                  round {artifact.iteration}
                                </Badge>
                              ) : null}
                              <span className="text-[11px] text-[oklch(0.45_0.03_242)]">{formatDate(artifact.createdAt)}</span>
                            </div>
                            <p className="mb-1 text-sm font-medium text-[oklch(0.29_0.04_246)]">{artifact.title}</p>
                            <p className="whitespace-pre-wrap text-xs leading-6 text-[oklch(0.39_0.03_242)]">{artifact.content}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[oklch(0.84_0.03_242)] bg-[oklch(0.98_0.02_238)] p-10 text-center text-sm text-[oklch(0.44_0.03_242)]">
                        当前步骤还没有可展示资产。运行步骤或发起对话后会自动沉淀。
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="trace" className="mt-4">
                    {agentTrace?.run ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-[oklch(0.84_0.03_242)] bg-[oklch(0.97_0.02_238)] px-3 py-2 text-xs text-[oklch(0.4_0.03_242)]">
                          Run #{agentTrace.run.id} · {agentTrace.run.strategy} · {agentTrace.run.status}
                          {" · "}stage: {agentTrace.run.currentStage}
                          {" · "}round: {agentTrace.run.currentIteration}
                        </div>
                        <div className="space-y-2">
                          {agentTrace.actions.map((action, index) => (
                            <div key={action.id} className="rounded-2xl border border-[oklch(0.84_0.03_242)] bg-white p-3">
                              <div className="mb-2 flex items-center gap-2">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[oklch(0.94_0.03_240)] text-[11px] text-[oklch(0.35_0.05_242)]">
                                  {index + 1}
                                </span>
                                <p className="text-sm font-medium text-[oklch(0.29_0.04_246)]">{action.title}</p>
                                <Badge variant="outline" className="text-[11px]">
                                  {action.actionType}
                                </Badge>
                              </div>
                              <p className="whitespace-pre-wrap text-xs leading-6 text-[oklch(0.39_0.03_242)]">{action.content}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[oklch(0.84_0.03_242)] bg-[oklch(0.98_0.02_238)] p-10 text-center text-sm text-[oklch(0.44_0.03_242)]">
                        还没有 Agent 轨迹。执行步骤后，这里会展示“计划、草稿、审查、定稿”全过程。
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </section>

          <aside className="space-y-4">
            <Card className="border-[oklch(0.84_0.03_242)] bg-white/88 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base text-[oklch(0.27_0.04_246)]">操作台</CardTitle>
                <CardDescription>先运行，再确认；不满意可以继续对话打磨。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {workflowCompleted ? (
                  <div className="rounded-xl border border-emerald-600/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
                    全流程已完成，可回看任意步骤结果与 Agent 轨迹。
                  </div>
                ) : (
                  <>
                    <Button
                      onClick={handleExecuteStep}
                      disabled={isExecuting || selectedAheadOfCurrent}
                      className="w-full bg-[linear-gradient(135deg,oklch(0.56_0.15_236),oklch(0.64_0.16_253))] text-white hover:brightness-105"
                    >
                      {isExecuting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          运行中...
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" />
                          {selectedStep?.status === "completed" ? "重跑该步骤" : "运行 Agent"}
                        </>
                      )}
                    </Button>

                    <Button
                      onClick={handleConfirmCurrentStep}
                      disabled={!selectedIsCurrent || selectedStep?.status !== "completed"}
                      variant="outline"
                      className="w-full border-[oklch(0.84_0.03_242)] bg-white hover:bg-[oklch(0.97_0.02_238)]"
                    >
                      确认并进入下一步
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>

                    <Button
                      onClick={handleSkipCurrentStep}
                      disabled={!selectedIsCurrent}
                      variant="outline"
                      className="w-full border-[oklch(0.84_0.03_242)] bg-white hover:bg-[oklch(0.97_0.02_238)]"
                    >
                      <SkipForward className="mr-2 h-4 w-4" />
                      跳过当前步骤
                    </Button>

                    {selectedAheadOfCurrent && (
                      <p className="rounded-xl border border-[oklch(0.84_0.03_242)] bg-[oklch(0.98_0.02_238)] px-3 py-2 text-xs text-[oklch(0.42_0.03_242)]">
                        当前选择的是未来步骤，先完成 Step {currentStepNumber + 1} 才能解锁。
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-[oklch(0.84_0.03_242)] bg-white/88 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-[oklch(0.27_0.04_246)]">
                  <GitBranch className="h-4 w-4" />
                  变更迭代 Agent
                </CardTitle>
                <CardDescription>输入优化/新增诉求，Agent 自动判断应从哪一步继续并分析影响范围。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={changeRequest}
                  onChange={(event) => setChangeRequest(event.target.value)}
                  placeholder="例如：在不改核心流程的前提下，新增企业级权限模型和审批链路。"
                  className="min-h-[110px] border-[oklch(0.84_0.03_242)] bg-white"
                />
                <Button
                  onClick={handleAnalyzeChangeRequest}
                  disabled={analyzeChangeMutation.isPending || !changeRequest.trim()}
                  className="w-full bg-[linear-gradient(135deg,oklch(0.56_0.15_236),oklch(0.64_0.16_253))] text-white"
                >
                  {analyzeChangeMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    <>
                      <WandSparkles className="mr-2 h-4 w-4" />
                      分析变更影响
                    </>
                  )}
                </Button>

                {changeAnalysis ? (
                  <div className="space-y-2 rounded-xl border border-[oklch(0.84_0.03_242)] bg-[oklch(0.98_0.02_238)] p-3">
                    <p className="text-sm font-medium text-[oklch(0.28_0.04_246)]">{changeAnalysis.summary}</p>
                    <p className="text-xs text-[oklch(0.42_0.03_242)]">{changeAnalysis.reason}</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="bg-white text-[11px]">
                        起步步骤: Step {changeAnalysis.recommendedStartStep + 1}
                      </Badge>
                      <Badge variant="outline" className="bg-white text-[11px]">
                        意图: {changeAnalysis.intentType}
                      </Badge>
                    </div>
                    <div className="text-xs text-[oklch(0.42_0.03_242)]">
                      影响步骤：
                      {changeAnalysis.impactedSteps.map((step) => (
                        <span key={step} className="ml-1 inline-flex rounded-full border border-[oklch(0.82_0.03_242)] bg-white px-2 py-0.5">
                          Step {step + 1}
                        </span>
                      ))}
                    </div>
                    {changeAnalysis.conflicts.length > 0 ? (
                      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-xs text-amber-700">
                        冲突提示：{changeAnalysis.conflicts[0]}
                      </div>
                    ) : null}
                    <Button
                      onClick={handleApplyChangePlan}
                      disabled={applyChangeMutation.isPending}
                      variant="outline"
                      className="w-full border-[oklch(0.82_0.06_242)] bg-white"
                    >
                      {applyChangeMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          应用中...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          从建议步骤继续迭代
                        </>
                      )}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-[oklch(0.84_0.03_242)] bg-white/88 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-[oklch(0.27_0.04_246)]">
                  <FileText className="h-4 w-4" />
                  原始需求
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="max-h-[220px] overflow-auto whitespace-pre-wrap text-sm leading-6 text-[oklch(0.39_0.03_242)]">
                  {project.rawRequirement}
                </p>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
