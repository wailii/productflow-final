import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { ArrowRight, CheckCircle2, Loader2, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";

const ROTATING_WORDS = ["讨论", "争论", "猜测", "返工", "拖延"];

const FLOW_PHASES = [
  {
    id: "01",
    name: "需求定向",
    steps: [
      {
        title: "需求预处理与澄清",
        desc: "补齐背景、业务目标、限制条件，列出待确认问题。",
        output: "澄清问题清单",
      },
      {
        title: "原始需求提炼",
        desc: "抽取核心诉求与关键场景，识别噪声信息。",
        output: "核心需求陈述",
      },
      {
        title: "需求转功能列表",
        desc: "把需求映射成最小可执行功能项并做优先级初排。",
        output: "功能 Backlog V1",
      },
    ],
  },
  {
    id: "02",
    name: "方案设计",
    steps: [
      {
        title: "功能设计细化",
        desc: "定义关键流程、业务规则、边界异常与验收标准。",
        output: "功能设计说明",
      },
      {
        title: "AI 原型提示词优化",
        desc: "将设计意图转为高质量提示词，统一原型表达口径。",
        output: "原型提示词包",
      },
      {
        title: "原型设计",
        desc: "生成可讨论的原型草案并标注关键交互。",
        output: "原型初稿",
      },
    ],
  },
  {
    id: "03",
    name: "交付沉淀",
    steps: [
      {
        title: "需求确认与调整",
        desc: "对齐分歧、处理冲突条款，确认最终需求边界。",
        output: "确认版需求",
      },
      {
        title: "功能性需求文档",
        desc: "固化功能说明、流程、状态、验收口径。",
        output: "功能 PRD",
      },
      {
        title: "补充章节生成",
        desc: "补齐非功能、风险、依赖与上线策略等章节。",
        output: "完整 PRD",
      },
    ],
  },
] as const;

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return "--";
  }
}

export default function Home() {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading, isAuthenticated, logout, refresh } = useAuth();

  const [rotatingWordIndex, setRotatingWordIndex] = useState(0);
  const [isWordVisible, setIsWordVisible] = useState(true);
  const cursorGlowRef = useRef<HTMLDivElement | null>(null);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);

  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [showAuthSlowHint, setShowAuthSlowHint] = useState(false);

  const [title, setTitle] = useState("");

  const [projectKeyword, setProjectKeyword] = useState("");
  const [projectFilter, setProjectFilter] = useState<"all" | "in_progress" | "completed" | "draft">("all");

  const { data: projects, isLoading: projectsLoading, refetch } =
    trpc.projects.list.useQuery(undefined, {
      enabled: isAuthenticated,
    });

  const createProject = trpc.projects.create.useMutation({
    onSuccess: (createdProject) => {
      toast.success("项目创建成功");
      setIsCreateDialogOpen(false);
      setTitle("");
      void refetch();
      if (createdProject?.id) {
        setLocation(`/project/${createdProject.id}`);
      }
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success("项目已删除");
      void refetch();
    },
    onError: (error) => {
      toast.error(`删除失败: ${error.message}`);
    },
  });

  const metrics = useMemo(() => {
    const list = projects ?? [];
    const completed = list.filter((item) => item.status === "completed").length;
    const inProgress = list.filter((item) => item.status === "in_progress").length;
    const completionRate =
      list.length > 0 ? Math.round((completed / list.length) * 100) : 0;

    return {
      total: list.length,
      inProgress,
      completionRate,
    };
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const keyword = projectKeyword.trim().toLowerCase();

    return (projects ?? []).filter((project) => {
      const titleText = String(project.title ?? "");
      const requirementText = String(project.rawRequirement ?? "");
      const matchesFilter =
        projectFilter === "all"
          ? true
          : projectFilter === "draft"
            ? project.status !== "completed" && project.status !== "in_progress"
            : project.status === projectFilter;

      if (!matchesFilter) return false;
      if (!keyword) return true;

      return (
        titleText.toLowerCase().includes(keyword) ||
        requirementText.toLowerCase().includes(keyword)
      );
    });
  }, [projects, projectFilter, projectKeyword]);

  const recentProjects = useMemo(() => {
    return [...(projects ?? [])]
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt).getTime();
        const bTime = new Date(b.updatedAt).getTime();
        const safeATime = Number.isFinite(aTime) ? aTime : 0;
        const safeBTime = Number.isFinite(bTime) ? bTime : 0;
        return safeBTime - safeATime;
      })
      .slice(0, 5);
  }, [projects]);

  useEffect(() => {
    if (isAuthenticated) return;

    const timer = window.setInterval(() => {
      setIsWordVisible(false);
      window.setTimeout(() => {
        setRotatingWordIndex((prev) => (prev + 1) % ROTATING_WORDS.length);
        setIsWordVisible(true);
      }, 200);
    }, 2500);

    return () => window.clearInterval(timer);
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) return;

    const glow = cursorGlowRef.current;
    if (!glow) return;

    let mouseX = 0;
    let mouseY = 0;
    let glowX = 0;
    let glowY = 0;
    let raf = 0;

    const onMouseMove = (event: MouseEvent) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
    };

    const animateGlow = () => {
      glowX += (mouseX - glowX) * 0.08;
      glowY += (mouseY - glowY) * 0.08;
      glow.style.left = `${glowX}px`;
      glow.style.top = `${glowY}px`;
      glow.style.opacity = "1";
      raf = window.requestAnimationFrame(animateGlow);
    };

    document.addEventListener("mousemove", onMouseMove);
    raf = window.requestAnimationFrame(animateGlow);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      window.cancelAnimationFrame(raf);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) return;

    const cards = Array.from(document.querySelectorAll<HTMLElement>(".pf-landing-page .tilt-card"));
    const cleanupFns: Array<() => void> = [];

    for (const card of cards) {
      const onMouseMove = (event: MouseEvent) => {
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -3;
        const rotateY = ((x - centerX) / centerX) * 3;
        card.style.transform =
          `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
      };

      const onMouseLeave = () => {
        card.style.transform = "perspective(800px) rotateX(0) rotateY(0) translateY(0)";
      };

      card.addEventListener("mousemove", onMouseMove);
      card.addEventListener("mouseleave", onMouseLeave);

      cleanupFns.push(() => {
        card.removeEventListener("mousemove", onMouseMove);
        card.removeEventListener("mouseleave", onMouseLeave);
      });
    }

    return () => {
      for (const fn of cleanupFns) {
        fn();
      }
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) return;

    const onScroll = () => {
      const nav = document.querySelector<HTMLElement>(".pf-landing-page nav");
      if (!nav) return;
      nav.style.borderBottomColor =
        window.scrollY > 100 ? "rgba(10,10,9,0.12)" : "rgba(10,10,9,0.08)";
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [isAuthenticated]);

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
      authMode === "register" ? "/api/auth/local/register" : "/api/auth/local/login";

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

  const handleCreateProject = () => {
    if (!title.trim()) {
      toast.error("请填写项目标题");
      return;
    }
    createProject.mutate({ title: title.trim() });
  };

  const handleDeleteProject = async (projectId: number, projectTitle: string) => {
    if (deleteProject.isPending) return;
    const confirmed = window.confirm(`确定删除项目「${projectTitle}」吗？此操作不可恢复。`);
    if (!confirmed) return;
    await deleteProject.mutateAsync({ projectId });
  };

  const getProjectProgress = (status: string, currentStep: number) => {
    if (status === "completed") return 100;
    if (status === "in_progress") return Math.min(100, Math.max(6, Math.round(((currentStep + 1) / 9) * 100)));
    return 6;
  };

  const getStatusMeta = (status: string, currentStep: number) => {
    if (status === "completed") {
      return { className: "done", text: "已完成" };
    }

    if (status === "in_progress") {
      return { className: "active", text: `进行中 · Step ${currentStep + 1}` };
    }

    return { className: "draft", text: "草稿" };
  };

  useEffect(() => {
    if (!authLoading) {
      setShowAuthSlowHint(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowAuthSlowHint(true);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [authLoading]);

  if (authLoading) {
    return (
      <div className="pf-page flex min-h-screen items-center justify-center px-4">
        <div className="pf-side-card max-w-md text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--pf-text-secondary)]" />
          <h3 className="mt-3">正在加载首页</h3>
          <p className="mt-2">
            正在验证登录状态并加载项目列表。
            {showAuthSlowHint ? " 如果长时间停留，请点击重试。" : ""}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              className="pf-btn-secondary"
              onClick={() => {
                void refresh();
              }}
            >
              重试
            </button>
            <button
              type="button"
              className="pf-btn-primary"
              onClick={() => window.location.reload()}
            >
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="pf-page pf-landing-page">
        <div className="cursor-glow" id="cursorGlow" ref={cursorGlowRef} />

        <nav>
          <a href="#" className="nav-logo">
            ProductFlow
          </a>
          <ul className="nav-links">
            <li>
              <a href="#why">能力</a>
            </li>
            <li>
              <a href="#flow">流程</a>
            </li>
            <li>
              <a href="workspace.html">工作台演示</a>
            </li>
          </ul>
          <a
            href="#"
            className="nav-cta"
            onClick={(event) => {
              event.preventDefault();
              setAuthMode("login");
              setIsAuthDialogOpen(true);
            }}
          >
            开始使用
          </a>
        </nav>

        <section className="hero" id="hero">
          <div className="hero-badge">
            <span className="dot" />
            AI-Powered Requirement Workflow
          </div>

          <h1>
            让需求分析
            <br />
            从"
            <span
              className="rotating-word"
              style={{
                opacity: isWordVisible ? 1 : 0,
                transform: isWordVisible ? "translateY(0)" : "translateY(-8px)",
                transition: "opacity 0.2s ease, transform 0.2s ease",
              }}
            >
              {ROTATING_WORDS[rotatingWordIndex]}
            </span>
            "走向"交付"
          </h1>

          <p className="hero-sub">
            ProductFlow 把需求澄清、功能设计、原型提示和 PRD 输出串成统一链路。
            <br />
            不是一次性回答，而是可追溯的流程化协作。
          </p>

          <div className="hero-actions">
            <a
              href="#"
              className="btn-primary"
              onClick={(event) => {
                event.preventDefault();
                setAuthMode("login");
                setIsAuthDialogOpen(true);
              }}
            >
              立即体验
              <ArrowRight className="h-4 w-4" />
            </a>
            <a href="#flow" className="btn-secondary">
              了解完整流程
            </a>
          </div>

          <div className="hero-mockup tilt-card">
            <div className="mockup-container">
              <div className="mockup-topbar">
                <span className="mockup-dot" />
                <span className="mockup-dot" />
                <span className="mockup-dot" />
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--fg-muted)" }}>
                  智能家居App · Step 3
                </span>
              </div>
              <div className="mockup-body">
                <div className="mockup-chat">
                  <div className="mock-msg">
                    <div className="mock-avatar user">你</div>
                    <div className="mock-bubble">我想做一个智能家居控制App，支持场景模式和能耗统计。</div>
                  </div>
                  <div className="mock-msg">
                    <div className="mock-avatar agent">P</div>
                    <div className="mock-bubble">
                      <strong>目标用户</strong>是谁？需要支持哪些<strong>设备协议</strong>？是否需要<strong>多用户权限</strong>？
                    </div>
                  </div>
                  <div className="mock-msg">
                    <div className="mock-avatar user">你</div>
                    <div className="mock-bubble">面向普通家庭，先支持WiFi。需要多用户权限区分。</div>
                  </div>
                  <div className="mock-msg">
                    <div className="mock-avatar agent">P</div>
                    <div>
                      <div className="mock-bubble">已完成需求提炼，产出功能列表：</div>
                      <div className="mock-asset">
                        <div className="mock-asset-icon">📊</div>
                        <span>功能列表 v1 · 4 模块 · 18 功能点</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mockup-assets">
                  <div className="mockup-assets-title">项目资产</div>
                  <div className="mock-asset-item">
                    <div className="mock-asset-dot" style={{ background: "#eef2ff" }}>📋</div>
                    <span className="mock-asset-text">需求概要</span>
                    <span className="mock-asset-badge">v1</span>
                  </div>
                  <div className="mock-asset-item">
                    <div className="mock-asset-dot" style={{ background: "#ecfdf5" }}>📝</div>
                    <span className="mock-asset-text">需求提炼清单</span>
                    <span className="mock-asset-badge">v1</span>
                  </div>
                  <div className="mock-asset-item">
                    <div className="mock-asset-dot" style={{ background: "#ecfdf5" }}>📊</div>
                    <span className="mock-asset-text">功能列表</span>
                    <span className="mock-asset-badge">v1</span>
                  </div>
                  <div className="mock-asset-item">
                    <div className="mock-asset-dot" style={{ background: "#fce7f3" }}>📐</div>
                    <span className="mock-asset-text">功能设计规格书</span>
                    <span className="mock-asset-badge" style={{ background: "#fdf6e3", color: "#b8860b" }}>
                      待生成
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="why-section" id="why">
          <div className="why-inner">
            <div className="reveal visible">
              <div className="section-label">Why ProductFlow</div>
              <h2 className="section-title">不是更聪明的回答，<br />而是更稳定的产出</h2>
              <p className="section-desc">重点不是展示模型有多聪明，而是让团队在真实项目里稳定产出。</p>
            </div>

            <div className="why-grid">
              <div className="why-card tilt-card reveal visible">
                <div className="why-card-num">01</div>
                <div className="why-card-title">从混乱输入到清晰目标</div>
                <div className="why-card-desc">先澄清再设计，避免"带着误解开工"。每一步都有输入、有输出、有可追溯上下文。</div>
              </div>
              <div className="why-card tilt-card reveal visible">
                <div className="why-card-num">02</div>
                <div className="why-card-title">流程化协作而非一次性回答</div>
                <div className="why-card-desc">9步标准化链路，从需求澄清到PRD交付。中间产出可追溯、可复盘、可修改。</div>
              </div>
              <div className="why-card tilt-card reveal visible">
                <div className="why-card-num">03</div>
                <div className="why-card-title">交付导向的 AI 工作台</div>
                <div className="why-card-desc">最终产出可以直接进入研发排期与执行。不是聊天记录，而是结构化的PRD文档。</div>
              </div>
            </div>
          </div>
        </section>

        <section className="flow-section" id="flow">
          <div className="flow-inner">
            <div className="reveal visible">
              <div className="section-label">Workflow Architecture</div>
              <h2 className="section-title">9 步流程，3 个阶段</h2>
              <p className="section-desc">先澄清需求，再形成方案，最后沉淀交付。顺着往下看就能理解全链路。</p>
            </div>

            <div className="flow-phases">
              {FLOW_PHASES.map((phase) => (
                <div key={phase.id} className="flow-phase reveal visible">
                  <div className="flow-phase-label">
                    <div className="flow-phase-num">{phase.id}</div>
                    <div className="flow-phase-name">{phase.name}</div>
                  </div>
                  <div className="flow-steps">
                    {phase.steps.map((step) => (
                      <div key={step.title} className="flow-step">
                        <div>
                          <div className="flow-step-title">{step.title}</div>
                          <div className="flow-step-desc">{step.desc}</div>
                        </div>
                        <div className="flow-step-output">→ {step.output}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="cta-section">
          <div className="cta-inner reveal visible">
            <div className="section-label">Start Now</div>
            <h2 className="section-title">把下一次需求评审，<br />变成可执行计划</h2>
            <p className="section-desc">登录后立刻创建项目，系统将自动初始化 9 步流程。</p>
            <a
              href="#"
              className="btn-primary"
              style={{ display: "inline-flex" }}
              onClick={(event) => {
                event.preventDefault();
                setAuthMode("login");
                setIsAuthDialogOpen(true);
              }}
            >
              进入 ProductFlow
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>

        <footer>
          <span className="footer-brand">ProductFlow</span>
          <ul className="footer-links">
            <li><a href="#">关于</a></li>
            <li><a href="#">文档</a></li>
            <li><a href="#">GitHub</a></li>
          </ul>
        </footer>

        <Dialog open={isAuthDialogOpen} onOpenChange={setIsAuthDialogOpen}>
          <DialogContent className="sm:max-w-[520px] border-[var(--pf-border-default)] bg-[var(--pf-surface-primary)]">
            <DialogHeader>
              <DialogTitle>{authMode === "register" ? "创建账号" : "登录 ProductFlow"}</DialogTitle>
              <DialogDescription>
                {authMode === "register"
                  ? "使用邮箱注册，马上开始你的需求分析流程。"
                  : "使用邮箱和密码登录，继续你的项目。"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 rounded-xl border border-[var(--pf-border-default)] bg-[var(--pf-surface-secondary)] p-1">
                <button
                  type="button"
                  onClick={() => setAuthMode("login")}
                  className={`rounded-lg px-3 py-2 text-sm transition ${
                    authMode === "login"
                      ? "bg-white text-[var(--pf-text-primary)] shadow-sm"
                      : "text-[var(--pf-text-secondary)]"
                  }`}
                >
                  登录
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("register")}
                  className={`rounded-lg px-3 py-2 text-sm transition ${
                    authMode === "register"
                      ? "bg-white text-[var(--pf-text-primary)] shadow-sm"
                      : "text-[var(--pf-text-secondary)]"
                  }`}
                >
                  注册
                </button>
              </div>

              {authMode === "register" ? (
                <div className="space-y-2">
                  <Label htmlFor="auth-name">姓名</Label>
                  <Input
                    id="auth-name"
                    placeholder="请输入姓名"
                    value={authName}
                    onChange={(event) => setAuthName(event.target.value)}
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="auth-email">邮箱</Label>
                <Input
                  id="auth-email"
                  type="email"
                  placeholder="you@company.com"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="auth-password">密码</Label>
                <Input
                  id="auth-password"
                  type="password"
                  placeholder="至少 8 位"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAuthDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleLocalAuthSubmit} disabled={isAuthSubmitting}>
                {isAuthSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {authMode === "register" ? "注册并登录" : "登录"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="pf-page pf-dashboard-page">
      <header className="pf-dashboard-topbar">
        <div className="pf-dashboard-brand">
          <strong>ProductFlow</strong>
          <span>项目管理工作台</span>
        </div>
        <div className="pf-dashboard-actions">
          <span className="pf-user-pill">{user?.name || user?.email}</span>
          <button
            type="button"
            className="pf-btn-ghost"
            onClick={() => setLocation("/settings")}
          >
            <Settings2 className="h-4 w-4" />
            个人设置
          </button>
          <button
            type="button"
            className="pf-btn-ghost"
            onClick={async () => {
              await logout();
              window.location.assign("/");
            }}
          >
            退出登录
          </button>
        </div>
      </header>

      <main className="pf-dashboard-main">
        <div className="pf-dashboard-layout">
          <section className="pf-dashboard-primary">
            <section className="pf-dashboard-grid">
              <div className="pf-dashboard-hero">
                <p className="pf-mono">Workflow Command Center</p>
                <h2>我的项目</h2>
                <p>统一管理并推进需求分析项目，实时查看进展与完成度。</p>
                <div className="pf-dashboard-metrics">
                  <div className="pf-metric-box">
                    <span>总项目</span>
                    <strong>{metrics.total}</strong>
                  </div>
                  <div className="pf-metric-box">
                    <span>进行中</span>
                    <strong>{metrics.inProgress}</strong>
                  </div>
                  <div className="pf-metric-box">
                    <span>完成率</span>
                    <strong>{metrics.completionRate}%</strong>
                  </div>
                </div>
              </div>

              <aside className="pf-dashboard-create">
                <div>
                  <p className="pf-mono">Quick Create</p>
                  <h3 className="text-lg font-semibold">创建新项目</h3>
                  <p>只输入标题即可创建项目，原始需求将在项目内首条消息中自动录入。</p>
                </div>
                <button
                  type="button"
                  className="pf-btn-primary mt-4 justify-center"
                  onClick={() => setIsCreateDialogOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  新建项目
                </button>
              </aside>
            </section>

            {projectsLoading ? (
              <div className="mt-8 flex items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-[var(--pf-text-secondary)]" />
              </div>
            ) : projects && projects.length > 0 ? (
              <>
                <section className="pf-project-toolbar">
                  <label className="pf-search-box">
                    <Search className="h-4 w-4 text-[var(--pf-text-tertiary)]" />
                    <input
                      value={projectKeyword}
                      onChange={(event) => setProjectKeyword(event.target.value)}
                      placeholder="搜索项目标题或需求关键词..."
                    />
                  </label>
                  <div className="pf-filter-row">
                    {[
                      { id: "all", label: "全部" },
                      { id: "in_progress", label: "进行中" },
                      { id: "completed", label: "已完成" },
                      { id: "draft", label: "草稿" },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`pf-filter-chip ${projectFilter === item.id ? "active" : ""}`}
                        onClick={() =>
                          setProjectFilter(item.id as "all" | "in_progress" | "completed" | "draft")
                        }
                      >
                        {item.label}
                      </button>
                    ))}
                    {(projectKeyword || projectFilter !== "all") ? (
                      <button
                        type="button"
                        className="pf-filter-clear"
                        onClick={() => {
                          setProjectKeyword("");
                          setProjectFilter("all");
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                        清空筛选
                      </button>
                    ) : null}
                  </div>
                </section>

                {filteredProjects.length > 0 ? (
                  <div className="pf-project-grid">
                    {filteredProjects.map((project) => {
                      const progress = getProjectProgress(project.status, project.currentStep);
                      const status = getStatusMeta(project.status, project.currentStep);

                      return (
                        <Link key={project.id} href={`/project/${project.id}`} className="pf-project-link">
                          <article className="pf-project-card">
                            <button
                              type="button"
                              className="pf-project-delete"
                              onClick={async (event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                await handleDeleteProject(project.id, project.title);
                              }}
                              disabled={deleteProject.isPending}
                              aria-label={`删除项目 ${project.title}`}
                              title="删除项目"
                            >
                              {deleteProject.isPending ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>

                            <div className="pf-project-card-top">
                              <h3 className="pf-project-card-title">{project.title}</h3>
                              <span className={`pf-project-status ${status.className}`}>{status.text}</span>
                            </div>

                            <p className="pf-project-card-desc">
                              {project.rawRequirement?.trim() || "尚未录入原始需求，进入项目后在对话框输入首条需求。"}
                            </p>

                            <div className="pf-progress-row">
                              <div className="pf-progress-meta">
                                <span>流程进度</span>
                                <span>{progress}%</span>
                              </div>
                              <div className="pf-progress-track">
                                <div className="pf-progress-fill" style={{ width: `${progress}%` }} />
                              </div>
                            </div>

                            <div className="pf-project-foot">
                              <span>创建 {formatDate(project.createdAt)}</span>
                              <span>更新 {formatDate(project.updatedAt)}</span>
                            </div>
                          </article>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <section className="pf-empty-state">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--pf-border-default)]">
                      <Search className="h-6 w-6 text-[var(--pf-text-tertiary)]" />
                    </div>
                    <h3 className="mt-3 text-lg font-semibold">没有匹配项目</h3>
                    <p>试试更换关键词或筛选条件。</p>
                    <button
                      type="button"
                      className="pf-btn-secondary mt-4"
                      onClick={() => {
                        setProjectKeyword("");
                        setProjectFilter("all");
                      }}
                    >
                      重置筛选
                    </button>
                  </section>
                )}
              </>
            ) : (
              <section className="pf-empty-state">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--pf-border-default)]">
                  <CheckCircle2 className="h-6 w-6 text-[var(--pf-text-tertiary)]" />
                </div>
                <h3 className="mt-3 text-lg font-semibold">还没有项目</h3>
                <p>点击“新建项目”开始你的第一个需求分析流程。</p>
                <button
                  type="button"
                  className="pf-btn-primary mt-4"
                  onClick={() => setIsCreateDialogOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  新建项目
                </button>
              </section>
            )}
          </section>

          <aside className="pf-dashboard-side">
            <section className="pf-side-card">
              <p className="pf-mono">Workspace Snapshot</p>
              <h3>推进状态</h3>
              <div className="pf-side-stat-grid">
                <div className="pf-side-stat">
                  <span>总项目</span>
                  <strong>{metrics.total}</strong>
                </div>
                <div className="pf-side-stat">
                  <span>进行中</span>
                  <strong>{metrics.inProgress}</strong>
                </div>
                <div className="pf-side-stat">
                  <span>完成率</span>
                  <strong>{metrics.completionRate}%</strong>
                </div>
              </div>
            </section>

            <section className="pf-side-card">
              <p className="pf-mono">9-Step Reference</p>
              <h3>流程结构</h3>
              <div className="pf-side-flow-list">
                {FLOW_PHASES.map((phase) => (
                  <div key={phase.id} className="pf-side-flow-item">
                    <div className="pf-side-flow-head">
                      <span className="pf-side-flow-id">{phase.id}</span>
                      <strong>{phase.name}</strong>
                    </div>
                    <span className="pf-side-flow-steps">
                      {phase.steps.map((step) => step.title).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="pf-side-card">
              <p className="pf-mono">Recent Updates</p>
              <h3>最近更新</h3>
              {recentProjects.length > 0 ? (
                <div className="pf-side-project-list">
                  {recentProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className="pf-side-project-item"
                      onClick={() => setLocation(`/project/${project.id}`)}
                    >
                      <strong>{project.title}</strong>
                      <span className="pf-side-project-meta">
                        Step {Math.min(project.currentStep + 1, 9)} · 更新 {formatDate(project.updatedAt)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="pf-side-muted">暂无项目更新。</p>
              )}
            </section>
          </aside>
        </div>
      </main>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[620px] border-[var(--pf-border-default)] bg-[var(--pf-surface-primary)]">
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>
              先输入项目标题即可创建。原始需求可在进入项目后的第一条消息中录入。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">项目标题</Label>
              <Input
                id="title"
                placeholder="例如：在线教育平台"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateProject} disabled={createProject.isPending}>
              {createProject.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              创建项目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
