import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  Layers3,
  Loader2,
  Plus,
  Rocket,
  Shield,
  Sparkles,
  Target,
  Wand2,
  Workflow,
} from "lucide-react";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { Link } from "wouter";
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const WORKFLOW_STEPS = [
  "需求预处理与澄清",
  "原始需求提炼",
  "需求转功能列表",
  "功能设计细化",
  "AI 原型提示词优化",
  "原型设计",
  "需求确认与调整",
  "功能性需求文档",
  "补充章节生成",
];

const LANDING_BENEFITS = [
  {
    title: "从混乱输入到清晰目标",
    subtitle: "先澄清再设计，避免“带着误解开工”",
    Icon: Target,
  },
  {
    title: "流程化协作而非一次性回答",
    subtitle: "每一步有输入、有输出、有可追溯上下文",
    Icon: Workflow,
  },
  {
    title: "交付导向的 AI 工作台",
    subtitle: "最终产出可以直接进入研发排期与执行",
    Icon: Rocket,
  },
];

const LANDING_PHASES = [
  {
    id: "01",
    label: "需求定向",
    title: "先对齐问题，再定义范围",
    summary: "先把模糊输入拆成可讨论的问题、目标和边界，避免团队在误解上推进。",
    steps: [
      {
        title: "需求预处理与澄清",
        action: "补齐背景、业务目标、限制条件，列出待确认问题。",
        output: "澄清问题清单",
      },
      {
        title: "原始需求提炼",
        action: "抽取核心诉求与关键场景，识别噪声信息。",
        output: "核心需求陈述",
      },
      {
        title: "需求转功能列表",
        action: "把需求映射成最小可执行功能项并做优先级初排。",
        output: "功能 Backlog V1",
      },
    ],
    output: "需求澄清文档 + 业务需求清单",
  },
  {
    id: "02",
    label: "方案设计",
    title: "从功能到方案，形成可评审版本",
    summary: "把功能项细化成设计方案，并产出原型表达，便于跨角色评审。",
    steps: [
      {
        title: "功能设计细化",
        action: "定义关键流程、业务规则、边界异常与验收标准。",
        output: "功能设计说明",
      },
      {
        title: "AI 原型提示词优化",
        action: "将设计意图转为高质量提示词，统一原型表达口径。",
        output: "原型提示词包",
      },
      {
        title: "原型设计",
        action: "生成可讨论的原型草案并标注关键交互。",
        output: "原型初稿",
      },
    ],
    output: "功能方案 + 原型提示词 + 迭代建议",
  },
  {
    id: "03",
    label: "交付沉淀",
    title: "评审收敛后直接进入交付",
    summary: "在评审中收敛争议，最终输出结构化 PRD，直接衔接研发排期。",
    steps: [
      {
        title: "需求确认与调整",
        action: "对齐分歧、处理冲突条款，确认最终需求边界。",
        output: "确认版需求结论",
      },
      {
        title: "功能性需求文档",
        action: "固化功能说明、流程、状态、验收口径。",
        output: "功能 PRD 主文档",
      },
      {
        title: "补充章节生成",
        action: "补齐非功能、风险、依赖与上线策略等章节。",
        output: "完整可执行 PRD",
      },
    ],
    output: "完整 PRD（功能 + 非功能章节）",
  },
];

const LANDING_DELIVERABLES = [
  {
    title: "流程透明",
    subtitle: "每一步都可追溯、可复盘",
    Icon: BarChart3,
  },
  {
    title: "协作友好",
    subtitle: "产品、设计、研发使用同一语境",
    Icon: ClipboardList,
  },
  {
    title: "风险可控",
    subtitle: "提前暴露边界条件和需求冲突",
    Icon: Shield,
  },
];

export default function Home() {
  const { user, loading: authLoading, isAuthenticated, logout, refresh } = useAuth();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [rawRequirement, setRawRequirement] = useState("");

  const { data: projects, isLoading: projectsLoading, refetch } = trpc.projects.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const createProject = trpc.projects.create.useMutation({
    onSuccess: () => {
      toast.success("项目创建成功");
      setIsCreateDialogOpen(false);
      setTitle("");
      setRawRequirement("");
      refetch();
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  const metrics = useMemo(() => {
    const list = projects ?? [];
    const completed = list.filter(item => item.status === "completed").length;
    const inProgress = list.filter(item => item.status === "in_progress").length;
    const completionRate =
      list.length > 0 ? Math.round((completed / list.length) * 100) : 0;

    return {
      total: list.length,
      completed,
      inProgress,
      completionRate,
    };
  }, [projects]);

  const { scrollYProgress } = useScroll();
  const landingProgress = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 28,
    mass: 0.2,
  });
  const heroOffsetY = useTransform(scrollYProgress, [0, 0.4], [0, -80]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.3], [1, 0.8]);

  const handleLocalAuthSubmit = async () => {
    if (!authEmail.trim() || !authPassword.trim()) {
      toast.error("请填写邮箱和密码");
      return;
    }
    if (authMode === "register" && !authName.trim()) {
      toast.error("注册时请填写姓名");
      return;
    }

    setIsAuthSubmitting(true);
    const endpoint =
      authMode === "register"
        ? "/api/auth/local/register"
        : "/api/auth/local/login";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(
          authMode === "register"
            ? {
                name: authName.trim(),
                email: authEmail.trim(),
                password: authPassword,
              }
            : {
                email: authEmail.trim(),
                password: authPassword,
              }
        ),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast.error(payload?.error ?? "登录失败");
        return;
      }

      toast.success(authMode === "register" ? "注册成功" : "登录成功");
      setIsAuthDialogOpen(false);
      setAuthPassword("");
      await refresh();
    } catch (error) {
      console.error("[Auth] local auth failed", error);
      toast.error("登录失败，请稍后重试");
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(165deg,oklch(0.11_0.02_258),oklch(0.15_0.03_255))]">
        <div className="rounded-2xl border border-border/40 bg-background/30 p-6 backdrop-blur">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="relative overflow-x-clip bg-[linear-gradient(180deg,oklch(0.985_0.01_238),oklch(0.965_0.03_235)_36%,oklch(0.97_0.03_78))] text-[oklch(0.27_0.03_248)]">
        <motion.div
          className="fixed left-0 top-0 z-40 h-1 w-full origin-left bg-[linear-gradient(90deg,oklch(0.58_0.16_240),oklch(0.76_0.14_67))]"
          style={{ scaleX: landingProgress }}
        />
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,oklch(0.76_0.04_240/.24)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.76_0.04_240/.24)_1px,transparent_1px)] [background-size:52px_52px]" />
        <motion.div
          className="pointer-events-none absolute -left-20 top-14 h-[27rem] w-[27rem] rounded-full bg-[radial-gradient(circle_at_center,oklch(0.74_0.16_240/.4),transparent_68%)] blur-2xl"
          animate={{ x: [0, 18, 0], y: [0, 22, 0], scale: [1, 1.08, 1] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="pointer-events-none absolute -right-24 top-48 h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle_at_center,oklch(0.83_0.14_70/.32),transparent_70%)] blur-2xl"
          animate={{ x: [0, -22, 0], y: [0, -18, 0], scale: [1, 1.12, 1] }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        />

        <header className="sticky top-0 z-20 border-b border-[oklch(0.84_0.03_244)] bg-white/74 backdrop-blur-xl">
          <div className="container flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-[linear-gradient(135deg,oklch(0.56_0.14_238),oklch(0.66_0.17_255))] px-2 py-1 text-xs font-semibold text-white shadow-[0_10px_22px_-14px_oklch(0.55_0.14_240/.95)]">
                PF
              </div>
              <div>
                <p className="font-display text-xl leading-none">ProductFlow</p>
                <p className="mt-1 text-xs text-[oklch(0.42_0.03_244)]">AI 需求分析工作台</p>
              </div>
            </div>
            <div className="hidden items-center gap-6 text-sm text-[oklch(0.42_0.03_244)] md:flex">
              <a href="#why" className="transition-colors hover:text-[oklch(0.29_0.05_242)]">能力</a>
              <a href="#flow" className="transition-colors hover:text-[oklch(0.29_0.05_242)]">流程</a>
              <a href="#deliverables" className="transition-colors hover:text-[oklch(0.29_0.05_242)]">产出</a>
            </div>
            <Button
              size="sm"
              className="bg-[linear-gradient(135deg,oklch(0.56_0.14_238),oklch(0.64_0.16_255))] text-white hover:brightness-105"
              onClick={() => {
                setAuthMode("login");
                setIsAuthDialogOpen(true);
              }}
            >
              立即体验
            </Button>
          </div>
        </header>

        <section className="container relative grid min-h-[calc(100vh-4rem)] items-center gap-10 py-14 lg:grid-cols-[1.06fr_0.94fr] lg:py-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            style={{ y: heroOffsetY, opacity: heroOpacity }}
            className="space-y-7"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-[oklch(0.8_0.05_242)] bg-white/80 px-4 py-2 text-sm text-[oklch(0.34_0.05_242)] shadow-[0_12px_24px_-20px_oklch(0.58_0.14_240/.9)]">
              <Wand2 className="h-4 w-4 text-[oklch(0.59_0.16_239)]" />
              不是聊天机器人，而是可执行流程引擎
            </div>

            <div className="space-y-4">
              <h1 className="font-display text-[2.65rem] leading-[1.05] text-[oklch(0.23_0.04_246)] sm:text-[3.4rem] lg:text-[4.2rem]">
                让需求分析
                <br />
                <span className="bg-[linear-gradient(94deg,oklch(0.48_0.12_236),oklch(0.62_0.16_248),oklch(0.76_0.13_68))] bg-clip-text text-transparent">
                  从“讨论”走向“交付”
                </span>
              </h1>
              <p className="max-w-2xl text-base leading-8 text-[oklch(0.39_0.03_243)] sm:text-lg">
                ProductFlow 把需求澄清、功能设计、原型提示和 PRD 输出串成统一链路。
                你可以继续追问每一步，也可以快速沉淀团队共识，减少反复返工。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="bg-[linear-gradient(135deg,oklch(0.56_0.15_236),oklch(0.65_0.17_253))] text-white shadow-[0_22px_36px_-18px_oklch(0.56_0.14_240/.92)] hover:brightness-105"
                onClick={() => {
                  setAuthMode("login");
                  setIsAuthDialogOpen(true);
                }}
              >
                <span className="inline-flex items-center gap-2">
                  登录开始使用
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Button>
              <a
                href="#flow"
                className="inline-flex items-center rounded-full border border-[oklch(0.82_0.04_242)] bg-white/75 px-4 py-2 text-sm text-[oklch(0.39_0.03_243)] shadow-sm transition-colors hover:text-[oklch(0.27_0.05_242)]"
              >
                向下了解完整流程
              </a>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[oklch(0.82_0.04_242)] bg-white/72 px-4 py-3 shadow-sm">
                <p className="text-2xl font-semibold text-[oklch(0.52_0.14_240)]">9 步</p>
                <p className="text-xs text-[oklch(0.43_0.03_242)]">标准化需求链路</p>
              </div>
              <div className="rounded-2xl border border-[oklch(0.82_0.04_242)] bg-white/72 px-4 py-3 shadow-sm">
                <p className="text-2xl font-semibold text-[oklch(0.52_0.14_240)]">可追溯</p>
                <p className="text-xs text-[oklch(0.43_0.03_242)]">每一步保留上下文</p>
              </div>
              <div className="rounded-2xl border border-[oklch(0.82_0.04_242)] bg-white/72 px-4 py-3 shadow-sm">
                <p className="text-2xl font-semibold text-[oklch(0.52_0.14_240)]">可落地</p>
                <p className="text-xs text-[oklch(0.43_0.03_242)]">输出直接进入研发</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08 }}
            whileHover={{ y: -4 }}
            className="relative overflow-hidden rounded-3xl border border-[oklch(0.82_0.04_242)] bg-white/78 p-6 shadow-[0_26px_60px_-34px_oklch(0.47_0.1_240/.5)] backdrop-blur"
          >
            <motion.div
              className="pointer-events-none absolute -left-10 -top-10 h-28 w-28 rounded-full bg-[radial-gradient(circle_at_center,oklch(0.74_0.16_242/.4),transparent_70%)]"
              animate={{ scale: [1, 1.12, 1], opacity: [0.35, 0.55, 0.35] }}
              transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="absolute right-4 top-4 rounded-full bg-[oklch(0.84_0.09_72)] px-2.5 py-1 text-[10px] font-medium text-[oklch(0.33_0.05_245)]">
              LIVE PIPELINE
            </div>
            <p className="text-xs uppercase tracking-[0.18em] text-[oklch(0.49_0.03_242)]">Workflow Snapshot</p>
            <h3 className="mt-2 text-xl font-semibold text-[oklch(0.24_0.04_246)]">实时流程预览</h3>
            <p className="mt-1 text-sm text-[oklch(0.42_0.03_242)]">以流程而不是单次回答组织 AI 生产力</p>

            <div className="mt-5 space-y-2.5">
              {WORKFLOW_STEPS.slice(0, 6).map((step, idx) => (
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.14 + idx * 0.05, duration: 0.3 }}
                  className="group flex items-center justify-between rounded-xl border border-[oklch(0.84_0.03_242)] bg-white/80 px-3 py-2.5 transition-colors hover:border-[oklch(0.74_0.08_242)]"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[oklch(0.92_0.03_240)] text-xs text-[oklch(0.42_0.03_243)]">
                      {idx + 1}
                    </span>
                    <span className="text-sm text-[oklch(0.28_0.04_246)]">{step}</span>
                  </div>
                  <span className="text-[11px] text-[oklch(0.43_0.03_242)]">Step {idx + 1}</span>
                </motion.div>
              ))}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {LANDING_BENEFITS.map((item) => (
                <div key={item.title} className="rounded-xl border border-[oklch(0.84_0.03_242)] bg-white/84 p-3">
                  <item.Icon className="mb-2 h-4 w-4 text-[oklch(0.57_0.14_242)]" />
                  <p className="text-sm font-medium text-[oklch(0.28_0.04_246)]">{item.title}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        <section id="why" className="border-y border-[oklch(0.86_0.03_242)] bg-white/58 py-16">
          <div className="container">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.45 }}
              className="mb-8 max-w-3xl"
            >
              <p className="text-xs uppercase tracking-[0.2em] text-[oklch(0.49_0.03_242)]">Why ProductFlow</p>
              <h2 className="mt-3 font-display text-4xl text-[oklch(0.24_0.04_246)]">为什么这套工作流更适合产品团队</h2>
              <p className="mt-3 text-[oklch(0.4_0.03_242)]">
                重点不是展示模型有多聪明，而是让团队在真实项目里稳定产出。下面这些能力，正好对应你们在需求阶段最容易丢失的信息。
              </p>
            </motion.div>

            <div className="grid gap-4 md:grid-cols-3">
              {LANDING_BENEFITS.map((item, idx) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.42, delay: idx * 0.06 }}
                  whileHover={{ y: -4 }}
                  className="rounded-2xl border border-[oklch(0.84_0.03_242)] bg-white/82 p-5 shadow-sm"
                >
                  <item.Icon className="mb-3 h-5 w-5 text-[oklch(0.57_0.14_242)]" />
                  <p className="text-lg font-medium text-[oklch(0.27_0.04_246)]">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-[oklch(0.42_0.03_242)]">{item.subtitle}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section id="flow" className="relative py-16">
          <motion.div
            className="pointer-events-none absolute left-1/2 top-8 h-24 w-[78%] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,oklch(0.7_0.14_240/.24),transparent_68%)] blur-2xl"
            animate={{ opacity: [0.25, 0.5, 0.25], scale: [0.96, 1.02, 0.96] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="container">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.45 }}
              className="mb-8 max-w-3xl"
            >
              <p className="text-xs uppercase tracking-[0.2em] text-[oklch(0.49_0.03_242)]">Workflow Architecture</p>
              <h2 className="mt-3 font-display text-4xl text-[oklch(0.24_0.04_246)]">按正常项目习惯推进的 9 步流程</h2>
              <p className="mt-3 text-[oklch(0.41_0.03_242)]">
                先澄清需求，再形成方案，最后沉淀交付。你不用切换视图或猜下一步，顺着往下看就能理解全链路。
              </p>
            </motion.div>

            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[oklch(0.84_0.03_242)] bg-white/78 px-4 py-3 shadow-sm">
                <p className="text-xs uppercase tracking-[0.16em] text-[oklch(0.49_0.03_242)]">Habit 01</p>
                <p className="mt-1 text-sm text-[oklch(0.29_0.04_246)]">先明确问题与范围，再进入方案设计。</p>
              </div>
              <div className="rounded-2xl border border-[oklch(0.84_0.03_242)] bg-white/78 px-4 py-3 shadow-sm">
                <p className="text-xs uppercase tracking-[0.16em] text-[oklch(0.49_0.03_242)]">Habit 02</p>
                <p className="mt-1 text-sm text-[oklch(0.29_0.04_246)]">每一步都要有中间产出，避免口头共识。</p>
              </div>
              <div className="rounded-2xl border border-[oklch(0.84_0.03_242)] bg-white/78 px-4 py-3 shadow-sm">
                <p className="text-xs uppercase tracking-[0.16em] text-[oklch(0.49_0.03_242)]">Habit 03</p>
                <p className="mt-1 text-sm text-[oklch(0.29_0.04_246)]">阶段评审后收敛到 PRD，直接衔接研发。</p>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[0.42fr_1.58fr]">
              <motion.aside
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.45 }}
                className="h-fit rounded-3xl border border-[oklch(0.84_0.03_242)] bg-white/84 p-5 shadow-sm lg:sticky lg:top-24"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-[oklch(0.49_0.03_242)]">Stage Overview</p>
                <h3 className="mt-2 text-xl font-semibold text-[oklch(0.25_0.04_246)]">标准操作顺序</h3>
                <div className="mt-4 space-y-3">
                  {LANDING_PHASES.map((phase, index) => (
                    <div key={phase.id} className="rounded-2xl border border-[oklch(0.84_0.03_242)] bg-white/84 px-3 py-2.5">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-[oklch(0.49_0.03_242)]">Phase {phase.id}</p>
                      <p className="mt-1 text-sm font-medium text-[oklch(0.28_0.04_246)]">{phase.label}</p>
                      <p className="mt-1 text-xs text-[oklch(0.42_0.03_242)]">覆盖 Step {index * 3 + 1} - Step {index * 3 + 3}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-2xl border border-[oklch(0.82_0.06_70)] bg-[oklch(0.98_0.03_82)] px-3 py-3 text-xs leading-5 text-[oklch(0.37_0.04_244)]">
                  无需点击切换。直接从上到下浏览，就能理解每一步输入、动作和输出。
                </div>
              </motion.aside>

              <div className="space-y-4">
                {LANDING_PHASES.map((phase, stageIndex) => (
                  <motion.article
                    key={phase.id}
                    initial={{ opacity: 0, y: 18 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.2 }}
                    transition={{ duration: 0.42, delay: stageIndex * 0.05 }}
                    whileHover={{ y: -2 }}
                    className="rounded-3xl border border-[oklch(0.84_0.03_242)] bg-white/84 p-5 shadow-sm sm:p-6"
                  >
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-[oklch(0.49_0.03_242)]">
                          Phase {phase.id} · {phase.label}
                        </p>
                        <h3 className="mt-1 text-2xl font-semibold text-[oklch(0.26_0.04_246)]">{phase.title}</h3>
                        <p className="mt-2 max-w-2xl text-sm text-[oklch(0.42_0.03_242)]">{phase.summary}</p>
                      </div>
                      <div className="rounded-xl border border-[oklch(0.84_0.03_242)] bg-white/74 px-4 py-2 text-right">
                        <p className="text-xs text-[oklch(0.46_0.03_242)]">阶段输出</p>
                        <p className="text-sm font-medium text-[oklch(0.27_0.04_246)]">{phase.output}</p>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      {phase.steps.map((step, idx) => (
                        <div
                          key={step.title}
                          className="rounded-2xl border border-[oklch(0.84_0.03_242)] bg-white/78 px-3.5 py-3 transition-all hover:-translate-y-0.5 hover:border-[oklch(0.74_0.09_242)]"
                        >
                          <p className="text-[11px] uppercase tracking-[0.16em] text-[oklch(0.49_0.03_242)]">
                            Step {stageIndex * 3 + idx + 1}
                          </p>
                          <p className="mt-1.5 text-sm font-medium text-[oklch(0.28_0.04_246)]">{step.title}</p>
                          <p className="mt-2 text-xs leading-5 text-[oklch(0.42_0.03_242)]">
                            操作: {step.action}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[oklch(0.38_0.04_242)]">
                            产出: {step.output}
                          </p>
                        </div>
                      ))}
                    </div>
                  </motion.article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="deliverables" className="border-y border-[oklch(0.86_0.03_242)] bg-white/58 py-16">
          <div className="container">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.45 }}
              className="mb-8 max-w-3xl"
            >
              <p className="text-xs uppercase tracking-[0.2em] text-[oklch(0.49_0.03_242)]">Delivery</p>
              <h2 className="mt-3 font-display text-4xl text-[oklch(0.24_0.04_246)]">你最终会得到什么</h2>
              <p className="mt-3 text-[oklch(0.41_0.03_242)]">
                不止一份答案，而是一组可协作、可维护、可持续迭代的需求资产。
              </p>
            </motion.div>

            <div className="grid gap-4 md:grid-cols-3">
              {LANDING_DELIVERABLES.map((item, idx) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.4, delay: idx * 0.06 }}
                  whileHover={{ y: -4 }}
                  className="rounded-2xl border border-[oklch(0.84_0.03_242)] bg-white/82 p-5 shadow-sm"
                >
                  <item.Icon className="mb-3 h-5 w-5 text-[oklch(0.57_0.14_242)]" />
                  <p className="text-lg font-medium text-[oklch(0.27_0.04_246)]">{item.title}</p>
                  <p className="mt-2 text-sm text-[oklch(0.42_0.03_242)]">{item.subtitle}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="container py-16">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.45 }}
            className="rounded-3xl border border-[oklch(0.82_0.04_242)] bg-[linear-gradient(135deg,white,oklch(0.95_0.03_236))] p-8 shadow-[0_26px_60px_-34px_oklch(0.49_0.1_240/.46)]"
          >
            <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[oklch(0.49_0.03_242)]">Start Now</p>
                <h3 className="mt-2 font-display text-4xl text-[oklch(0.24_0.04_246)]">把你的下一次需求评审，变成可执行计划</h3>
                <p className="mt-3 max-w-2xl text-[oklch(0.42_0.03_242)]">
                  登录后立刻创建项目，系统将自动初始化 9 步流程，你可以从任意一步继续打磨。
                </p>
              </div>
              <Button
                size="lg"
                className="bg-[linear-gradient(135deg,oklch(0.56_0.15_236),oklch(0.64_0.16_253))] text-white hover:brightness-105"
                onClick={() => {
                  setAuthMode("login");
                  setIsAuthDialogOpen(true);
                }}
              >
                <span className="inline-flex items-center gap-2">
                  进入 ProductFlow
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Button>
            </div>
          </motion.div>
        </section>

        <Dialog open={isAuthDialogOpen} onOpenChange={setIsAuthDialogOpen}>
          <DialogContent className="sm:max-w-[520px] border-[oklch(0.84_0.03_242)] bg-white/96">
            <DialogHeader>
              <DialogTitle className="text-[oklch(0.25_0.04_246)]">
                {authMode === "register" ? "创建账号" : "登录 ProductFlow"}
              </DialogTitle>
              <DialogDescription>
                {authMode === "register"
                  ? "使用邮箱注册，马上开始你的需求分析流程。"
                  : "使用邮箱和密码登录，继续你的项目。"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 rounded-xl border border-[oklch(0.84_0.03_242)] bg-[oklch(0.98_0.02_238)] p-1">
                <button
                  type="button"
                  onClick={() => setAuthMode("login")}
                  className={`rounded-lg px-3 py-2 text-sm transition ${
                    authMode === "login"
                      ? "bg-white text-[oklch(0.25_0.04_246)] shadow-sm"
                      : "text-[oklch(0.42_0.03_242)]"
                  }`}
                >
                  登录
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("register")}
                  className={`rounded-lg px-3 py-2 text-sm transition ${
                    authMode === "register"
                      ? "bg-white text-[oklch(0.25_0.04_246)] shadow-sm"
                      : "text-[oklch(0.42_0.03_242)]"
                  }`}
                >
                  注册
                </button>
              </div>

              {authMode === "register" && (
                <div className="space-y-2">
                  <Label htmlFor="auth-name">姓名</Label>
                  <Input
                    id="auth-name"
                    placeholder="请输入姓名"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="auth-email">邮箱</Label>
                <Input
                  id="auth-email"
                  type="email"
                  placeholder="you@company.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="auth-password">密码</Label>
                <Input
                  id="auth-password"
                  type="password"
                  placeholder="至少 8 位"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsAuthDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                onClick={handleLocalAuthSubmit}
                disabled={isAuthSubmitting}
                className="bg-[linear-gradient(135deg,oklch(0.56_0.15_236),oklch(0.64_0.16_253))] text-white hover:brightness-105"
              >
                {isAuthSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {authMode === "register" ? "注册并登录" : "登录"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const handleCreateProject = () => {
    if (!title.trim() || !rawRequirement.trim()) {
      toast.error("请填写项目标题和原始需求");
      return;
    }
    createProject.mutate({ title, rawRequirement });
  };

  const getStatusBadge = (status: string, currentStep: number) => {
    if (status === "completed") {
      return (
        <div className="flex items-center gap-1.5 text-emerald-500">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-sm font-medium">已完成</span>
        </div>
      );
    }
    if (status === "in_progress") {
      return (
        <div className="flex items-center gap-1.5 text-amber-500">
          <Clock3 className="w-4 h-4" />
          <span className="text-sm font-medium">进行中 (Step {currentStep + 1}/9)</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <FileText className="w-4 h-4" />
        <span className="text-sm font-medium">草稿</span>
      </div>
    );
  };

  const getProgressPercent = (status: string, currentStep: number) => {
    if (status === "completed") return 100;
    if (status === "in_progress") return Math.min(100, Math.max(6, Math.round(((currentStep + 1) / 9) * 100)));
    return 6;
  };

  return (
    <div className="relative min-h-screen bg-[linear-gradient(180deg,oklch(0.98_0.01_250),oklch(0.97_0.015_240)_45%,oklch(0.98_0.01_85))] text-[oklch(0.3_0.03_252)]">
      <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(to_right,oklch(0.72_0.03_244/.2)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.72_0.03_244/.2)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="pointer-events-none absolute -left-24 top-24 h-80 w-80 rounded-full bg-[oklch(0.8_0.08_245/.18)] blur-3xl" />
      <div className="pointer-events-none absolute -right-24 top-56 h-80 w-80 rounded-full bg-[oklch(0.86_0.08_85/.16)] blur-3xl" />

      <header className="sticky top-0 z-10 border-b border-[oklch(0.84_0.02_250)] bg-white/72 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[oklch(0.3_0.05_248)] px-2 py-1 text-xs font-semibold text-white">
              PF
            </div>
            <div>
              <h1 className="font-display text-xl leading-none">ProductFlow</h1>
              <p className="mt-1 text-xs text-[oklch(0.45_0.02_250)]">产品需求分析工作流</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="rounded-full border border-[oklch(0.84_0.02_250)] bg-white/70 px-3 py-1 text-sm text-[oklch(0.43_0.02_248)]">
              {user?.name || user?.email}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="border-[oklch(0.84_0.02_250)] bg-white/60 hover:bg-white"
              onClick={async () => {
                await logout();
                window.location.assign("/");
              }}
            >
              退出登录
            </Button>
          </div>
        </div>
      </header>

      <main className="container relative py-8">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-7 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]"
        >
          <div className="rounded-3xl border border-[oklch(0.84_0.02_250)] bg-white/76 p-6 shadow-sm backdrop-blur">
            <div className="inline-flex items-center gap-2 rounded-full border border-[oklch(0.85_0.02_250)] bg-[oklch(0.95_0.02_248)] px-3 py-1 text-xs text-[oklch(0.45_0.02_248)]">
              <Sparkles className="h-3.5 w-3.5 text-[oklch(0.53_0.11_248)]" />
              Workflow Command Center
            </div>
            <h2 className="mt-4 font-display text-4xl text-[oklch(0.25_0.03_252)]">我的项目</h2>
            <p className="mt-2 text-[oklch(0.43_0.02_248)]">管理并推进你的需求分析项目</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[oklch(0.86_0.02_250)] bg-white/70 px-3 py-3">
                <p className="text-xs text-[oklch(0.48_0.02_248)]">总项目</p>
                <p className="mt-1 text-2xl font-semibold text-[oklch(0.37_0.06_248)]">{metrics.total}</p>
              </div>
              <div className="rounded-xl border border-[oklch(0.86_0.02_250)] bg-white/70 px-3 py-3">
                <p className="text-xs text-[oklch(0.48_0.02_248)]">进行中</p>
                <p className="mt-1 text-2xl font-semibold text-[oklch(0.65_0.13_84)]">{metrics.inProgress}</p>
              </div>
              <div className="rounded-xl border border-[oklch(0.86_0.02_250)] bg-white/70 px-3 py-3">
                <p className="text-xs text-[oklch(0.48_0.02_248)]">完成率</p>
                <p className="mt-1 text-2xl font-semibold text-[oklch(0.56_0.11_165)]">{metrics.completionRate}%</p>
              </div>
            </div>
          </div>
          <div className="rounded-3xl border border-[oklch(0.84_0.02_250)] bg-white/76 p-6 shadow-sm backdrop-blur">
            <p className="text-xs uppercase tracking-[0.18em] text-[oklch(0.49_0.02_248)]">Quick Create</p>
            <p className="mt-2 text-sm text-[oklch(0.44_0.02_248)]">建立一个新的需求分析项目，自动生成 9 步工作流。</p>
            <Button
              className="mt-6 w-full bg-[oklch(0.34_0.06_248)] text-white shadow-[0_16px_34px_-18px_oklch(0.52_0.12_248/.85)] hover:bg-[oklch(0.38_0.06_248)]"
              onClick={() => setIsCreateDialogOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              新建项目
            </Button>
          </div>
        </motion.section>

        {projectsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[oklch(0.5_0.04_248)]" />
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Link key={project.id} href={`/project/${project.id}`}>
                <Card className="group h-full cursor-pointer overflow-hidden border-[oklch(0.84_0.02_250)] bg-white/85 transition-all duration-300 hover:-translate-y-0.5 hover:border-[oklch(0.6_0.06_248)] hover:shadow-[0_24px_45px_-30px_oklch(0.42_0.06_248/.5)]">
                  <div className="h-1 w-full bg-gradient-to-r from-[oklch(0.5_0.11_248)] via-[oklch(0.62_0.14_85)] to-transparent" />
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="line-clamp-1 text-lg text-[oklch(0.27_0.03_250)] group-hover:text-[oklch(0.4_0.07_248)]">
                        {project.title}
                      </CardTitle>
                      {getStatusBadge(project.status, project.currentStep)}
                    </div>
                    <CardDescription className="line-clamp-2 text-[oklch(0.44_0.02_248)]">
                      {project.rawRequirement}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3">
                      <div className="mb-1.5 flex items-center justify-between text-xs text-[oklch(0.46_0.02_248)]">
                        <span>进度</span>
                        <span>{getProgressPercent(project.status, project.currentStep)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[oklch(0.9_0.015_248)]">
                        <div
                          className="h-1.5 rounded-full bg-gradient-to-r from-[oklch(0.52_0.11_248)] to-[oklch(0.68_0.14_85)] transition-all"
                          style={{ width: `${getProgressPercent(project.status, project.currentStep)}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-[oklch(0.46_0.02_248)]">
                      <span>
                        创建于 {new Date(project.createdAt).toLocaleDateString("zh-CN")}
                      </span>
                      <span>
                        更新于 {new Date(project.updatedAt).toLocaleDateString("zh-CN")}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="border-dashed border-[oklch(0.84_0.02_250)] bg-white/70 py-16">
            <CardContent className="text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[oklch(0.84_0.02_250)] bg-white/75">
                <FileText className="h-7 w-7 text-[oklch(0.5_0.02_248)]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[oklch(0.3_0.03_252)]">还没有项目</h3>
                <p className="mt-1 text-[oklch(0.44_0.02_248)]">
                  点击"新建项目"开始您的第一个需求分析
                </p>
              </div>
              <Button className="bg-[oklch(0.34_0.06_248)] text-white hover:bg-[oklch(0.38_0.06_248)]" onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                新建项目
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[620px] border-[oklch(0.84_0.02_250)] bg-white/95">
          <DialogHeader>
            <DialogTitle className="text-[oklch(0.26_0.03_252)]">新建项目</DialogTitle>
            <DialogDescription>
              输入项目标题和原始需求，AI 将帮助您完成 9 步需求分析流程
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">项目标题</Label>
              <Input
                id="title"
                placeholder="例如：在线教育平台"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="requirement">原始需求</Label>
              <Textarea
                id="requirement"
                placeholder="请描述您的原始需求，可以是模糊的、不完整的，AI 会帮助您澄清..."
                className="min-h-[200px]"
                value={rawRequirement}
                onChange={(e) => setRawRequirement(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              onClick={handleCreateProject}
              disabled={createProject.isPending}
            >
              {createProject.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              创建项目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
