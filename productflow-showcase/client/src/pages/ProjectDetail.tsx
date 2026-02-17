import { useEffect, useMemo, useState } from "react";
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
  Loader2,
  MessageSquare,
  Play,
  SkipForward,
  Sparkles,
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

type PanelTab = "output" | "chat" | "trace";

export default function ProjectDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = Number.parseInt(params.id || "0", 10);

  const [selectedStepNumber, setSelectedStepNumber] = useState(0);
  const [activeTab, setActiveTab] = useState<PanelTab>("output");
  const [userMessage, setUserMessage] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  const { data: project, isLoading: projectLoading, refetch: refetchProject } =
    trpc.projects.get.useQuery({ projectId });
  const { data: steps, isLoading: stepsLoading, refetch: refetchSteps } =
    trpc.workflow.getSteps.useQuery({ projectId });
  const { data: conversation, refetch: refetchConversation } =
    trpc.workflow.getConversation.useQuery(
      { projectId, stepNumber: selectedStepNumber },
      { enabled: !!project && selectedStepNumber >= 0 && selectedStepNumber <= 8 }
    );
  const { data: agentTrace, refetch: refetchAgentTrace } =
    trpc.workflow.getAgentTrace.useQuery(
      { projectId, stepNumber: selectedStepNumber },
      { enabled: !!project && selectedStepNumber >= 0 && selectedStepNumber <= 8 }
    );

  const executeStepMutation = trpc.workflow.executeStep.useMutation();
  const continueConversationMutation = trpc.workflow.continueConversation.useMutation();
  const confirmStepMutation = trpc.workflow.confirmStep.useMutation();
  const skipStepMutation = trpc.workflow.skipStep.useMutation();

  const currentStepNumber = Math.min(project?.currentStep ?? 0, 8);
  const workflowCompleted = (project?.currentStep ?? 0) >= 9;
  const selectedStep = steps?.find((step) => step.stepNumber === selectedStepNumber) ?? null;
  const completedStepCount = useMemo(
    () => (steps ?? []).filter((step) => step.status === "completed").length,
    [steps]
  );
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
      setActiveTab("trace");
      toast.success("Agent 已完成新一轮打磨");
    } catch (error: any) {
      toast.error(error.message || "对话失败");
    } finally {
      setIsExecuting(false);
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
      await Promise.all([refetchConversation(), refetchAgentTrace()]);
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
      await Promise.all([refetchConversation(), refetchAgentTrace()]);
      toast.success("已跳过当前步骤");
    } catch (error: any) {
      toast.error(error.message || "跳过失败");
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
              <h1 className="font-display text-2xl text-[oklch(0.25_0.04_246)]">
                {project.title}
              </h1>
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
        <div className="grid gap-5 xl:grid-cols-[300px_1fr_320px]">
          <aside className="space-y-4">
            <Card className="border-[oklch(0.84_0.03_242)] bg-white/86 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base text-[oklch(0.27_0.04_246)]">
                  执行总览
                </CardTitle>
                <CardDescription>
                  完成 {completedStepCount}/9 · 进度 {progress}%
                </CardDescription>
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
                  <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl border border-[oklch(0.85_0.03_242)] bg-[oklch(0.97_0.02_238)] p-1">
                    <TabsTrigger value="output" className="rounded-lg">
                      <Sparkles className="h-4 w-4" />
                      结果
                    </TabsTrigger>
                    <TabsTrigger value="chat" className="rounded-lg">
                      <MessageSquare className="h-4 w-4" />
                      对话
                    </TabsTrigger>
                    <TabsTrigger value="trace" className="rounded-lg">
                      <Bot className="h-4 w-4" />
                      Agent 轨迹
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
                    <div className="max-h-[380px] space-y-3 overflow-auto rounded-2xl border border-[oklch(0.85_0.03_242)] bg-white p-4">
                      {conversation && conversation.length > 0 ? (
                        conversation.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                                msg.role === "user"
                                  ? "bg-[oklch(0.52_0.13_240)] text-white"
                                  : "bg-[oklch(0.95_0.02_240)] text-[oklch(0.32_0.03_242)]"
                              }`}
                            >
                              <p className="mb-1 text-[11px] opacity-70">
                                {msg.role === "user" ? "你" : "Agent"}
                              </p>
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-[oklch(0.44_0.03_242)]">
                          还没有对话记录。先运行该步骤后再继续提问。
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Textarea
                        value={userMessage}
                        onChange={(event) => setUserMessage(event.target.value)}
                        placeholder="补充你的修改意见，Agent 会基于当前步骤继续打磨..."
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
                            <MessageSquare className="mr-2 h-4 w-4" />
                            继续对话打磨
                          </>
                        )}
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="trace" className="mt-4">
                    {agentTrace?.run ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-[oklch(0.84_0.03_242)] bg-[oklch(0.97_0.02_238)] px-3 py-2 text-xs text-[oklch(0.4_0.03_242)]">
                          Run #{agentTrace.run.id} · {agentTrace.run.strategy} · {agentTrace.run.status}
                        </div>
                        <div className="space-y-2">
                          {agentTrace.actions.map((action, index) => (
                            <div
                              key={action.id}
                              className="rounded-2xl border border-[oklch(0.84_0.03_242)] bg-white p-3"
                            >
                              <div className="mb-2 flex items-center gap-2">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[oklch(0.94_0.03_240)] text-[11px] text-[oklch(0.35_0.05_242)]">
                                  {index + 1}
                                </span>
                                <p className="text-sm font-medium text-[oklch(0.29_0.04_246)]">
                                  {action.title}
                                </p>
                                <Badge variant="outline" className="text-[11px]">
                                  {action.actionType}
                                </Badge>
                              </div>
                              <p className="whitespace-pre-wrap text-xs leading-6 text-[oklch(0.39_0.03_242)]">
                                {action.content}
                              </p>
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
                <CardTitle className="text-base text-[oklch(0.27_0.04_246)]">
                  操作台
                </CardTitle>
                <CardDescription>先运行，再确认；如果不满意可继续对话打磨。</CardDescription>
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
                <CardTitle className="text-base text-[oklch(0.27_0.04_246)]">
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
