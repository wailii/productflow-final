export interface WorkflowStep {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  phase: "discovery" | "design" | "validation" | "documentation";
  inputs: string[];
  outputs: string[];
  keyActivities: string[];
  aiTip: string;
  duration: string;
}

export const workflowSteps: WorkflowStep[] = [
  {
    id: 1,
    title: "需求预处理与澄清",
    subtitle: "Requirement Clarification",
    description:
      "对原始需求进行初步分析，识别模糊概念、矛盾点和信息缺失，生成结构化的澄清问卷，确保需求理解的准确性。",
    phase: "discovery",
    inputs: ["原始需求文档", "会议记录", "用户反馈"],
    outputs: ["澄清问卷", "需求分析报告"],
    keyActivities: [
      "识别模糊概念和矛盾点",
      "标记信息缺失项",
      "生成结构化澄清问卷",
      "与需求方确认理解",
    ],
    aiTip:
      "将原始需求文档粘贴给 AI，让它识别模糊概念、矛盾和信息缺失，并生成澄清问卷。",
    duration: "10-20 分钟",
  },
  {
    id: 2,
    title: "原始需求提炼",
    subtitle: "Requirement Extraction",
    description:
      "基于澄清后的需求，进行需求类型诊断，提炼用户画像、项目目标和业务需求清单，形成结构化的需求分析成果。",
    phase: "discovery",
    inputs: ["澄清后的需求文档", "澄清问卷回复"],
    outputs: ["用户画像", "项目目标", "业务需求清单"],
    keyActivities: [
      "诊断需求类型（新建/改造/集成）",
      "提炼用户画像",
      "梳理项目目标",
      "编制业务需求清单",
    ],
    aiTip:
      "将澄清文档粘贴给 AI，让它诊断需求类型，提炼用户画像和业务需求清单。",
    duration: "15-30 分钟",
  },
  {
    id: 3,
    title: "需求转功能列表",
    subtitle: "Feature Mapping",
    description:
      "将业务需求映射为功能需求，控制粒度在 6-10 个核心功能，确保每个功能都有明确的业务价值对应。",
    phase: "design",
    inputs: ["业务需求清单", "用户画像"],
    outputs: ["功能列表", "需求映射矩阵"],
    keyActivities: [
      "业务需求到功能的映射",
      "功能粒度控制（6-10个）",
      "功能优先级排序",
      "确认功能覆盖度",
    ],
    aiTip:
      "将业务需求清单粘贴给 AI，让它转换为功能列表，控制粒度在 6-10 个功能。",
    duration: "10-15 分钟",
  },
  {
    id: 4,
    title: "功能设计细化",
    subtitle: "Feature Design",
    description:
      "对每个功能进行 7 个维度的详细设计：功能概述、业务流程、用户旅程、数据字段、交互设计、业务逻辑、功能关系。",
    phase: "design",
    inputs: ["功能列表", "用户画像", "业务需求"],
    outputs: ["7 维度功能设计方案"],
    keyActivities: [
      "功能概述编写",
      "业务流程设计",
      "用户旅程梳理",
      "数据字段定义",
      "交互设计规划",
      "业务逻辑梳理",
      "功能关系映射",
    ],
    aiTip:
      "让 AI 为每个功能进行 7 维度设计：概述、流程、旅程、字段、交互、逻辑、关系。",
    duration: "30-60 分钟",
  },
  {
    id: 5,
    title: "AI 原型提示词优化",
    subtitle: "Prototype Prompt",
    description:
      "将功能设计方案转化为 AI 原型工具可用的提示词，包含上下文信息、功能描述、平台规范和组件要求。",
    phase: "design",
    inputs: ["功能设计方案"],
    outputs: ["AI 原型提示词"],
    keyActivities: [
      "提取关键设计信息",
      "构建提示词结构",
      "添加平台规范约束",
      "优化提示词表达",
    ],
    aiTip:
      "将功能设计方案粘贴给 AI，让它转换为原型工具提示词，包含上下文、描述、平台、组件。",
    duration: "5-10 分钟",
  },
  {
    id: 6,
    title: "原型设计",
    subtitle: "Prototype Design",
    description:
      "使用 AI 原型工具（Motiff、Figma AI、Google Stitch 等）生成交互原型，将抽象的功能设计转化为可视化的界面方案。",
    phase: "design",
    inputs: ["AI 原型提示词", "功能设计方案"],
    outputs: ["交互原型"],
    keyActivities: [
      "选择合适的 AI 原型工具",
      "输入优化后的提示词",
      "审查生成的原型",
      "调整和优化原型",
    ],
    aiTip:
      "推荐使用 Motiff、Figma AI、Google Stitch、Galileo AI 或 Ready 等工具。",
    duration: "15-30 分钟",
  },
  {
    id: 7,
    title: "需求确认与调整",
    subtitle: "Requirement Review",
    description:
      "从功能覆盖度、流程合理性、交互设计、一致性四个维度全面审查方案，确保没有遗漏或偏差。",
    phase: "validation",
    inputs: ["功能设计方案", "交互原型"],
    outputs: ["审查报告", "调整计划"],
    keyActivities: [
      "功能覆盖度审查",
      "流程合理性审查",
      "交互设计审查",
      "一致性审查",
    ],
    aiTip:
      "将业务需求清单和功能设计方案一起粘贴给 AI，让它从 4 个维度进行审查。",
    duration: "10-15 分钟",
  },
  {
    id: 8,
    title: "功能性需求文档",
    subtitle: "Functional Requirements",
    description:
      "生成需求说明书第五章（功能性需求），每个功能包含需求描述、8 字段数据字典和 6 条目功能场景说明。",
    phase: "documentation",
    inputs: ["功能设计方案", "交互原型"],
    outputs: ["功能性需求文档（第五章）"],
    keyActivities: [
      "编写需求描述",
      "构建 8 字段数据字典",
      "编写 6 条目场景说明",
      "统一文档格式",
    ],
    aiTip:
      "让 AI 生成第五章，每个功能包含描述、8字段数据字典、6条目场景说明。",
    duration: "15-30 分钟",
  },
  {
    id: 9,
    title: "补充章节生成",
    subtitle: "Complete Documentation",
    description:
      "生成需求说明书的其他章节（第 2、3、4、6 章），形成完整的需求说明书，包括项目概述、用户角色、总体需求和关键问题。",
    phase: "documentation",
    inputs: ["前序所有步骤的输出"],
    outputs: ["完整需求说明书"],
    keyActivities: [
      "编写项目概述（第二章）",
      "定义用户角色（第三章）",
      "梳理总体需求（第四章）",
      "记录关键问题（第六章）",
    ],
    aiTip:
      "将前序所有步骤输出粘贴给 AI，让它生成第 2、3、4、6 章，建议分章节生成。",
    duration: "20-40 分钟",
  },
];

export const phaseInfo = {
  discovery: {
    label: "需求发现",
    labelEn: "Discovery",
    color: "from-blue-500 to-cyan-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    textColor: "text-blue-400",
    dotColor: "bg-blue-400",
  },
  design: {
    label: "方案设计",
    labelEn: "Design",
    color: "from-amber-500 to-orange-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    textColor: "text-amber-400",
    dotColor: "bg-amber-400",
  },
  validation: {
    label: "验证确认",
    labelEn: "Validation",
    color: "from-emerald-500 to-teal-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    textColor: "text-emerald-400",
    dotColor: "bg-emerald-400",
  },
  documentation: {
    label: "文档输出",
    labelEn: "Documentation",
    color: "from-purple-500 to-violet-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    textColor: "text-purple-400",
    dotColor: "bg-purple-400",
  },
};

export const aiTools = [
  {
    name: "ChatGPT",
    description: "综合能力强，中文支持好",
    useCase: "需求分析、文档生成",
  },
  {
    name: "Claude",
    description: "上下文窗口大，逻辑严谨",
    useCase: "长文档分析、结构化输出",
  },
  {
    name: "Gemini",
    description: "支持图片输入，数据分析强",
    useCase: "多模态分析、数据处理",
  },
  {
    name: "DeepSeek",
    description: "技术理解深，性价比高",
    useCase: "技术需求分析、代码相关",
  },
];

export const prototypeTools = [
  {
    name: "Motiff",
    description: "AI 驱动的设计工具，支持从文字生成 UI",
    url: "https://motiff.com",
  },
  {
    name: "Figma AI",
    description: "Figma 内置 AI 功能，设计生态完善",
    url: "https://figma.com",
  },
  {
    name: "Google Stitch",
    description: "Google 推出的 AI 原型设计工具",
    url: "https://stitch.withgoogle.com",
  },
  {
    name: "Galileo AI",
    description: "从文字描述生成高保真 UI 设计",
    url: "https://www.usegalileo.ai",
  },
  {
    name: "Ready",
    description: "AI 驱动的快速原型设计平台",
    url: "https://ready.so",
  },
];

export const templateFeatures = [
  {
    title: "9 步标准化流程",
    description: "从需求澄清到文档输出，每一步都有明确的输入、输出和操作指南",
    icon: "workflow",
  },
  {
    title: "项目看板管理",
    description: "可视化追踪多个项目的进度，一目了然的状态管理",
    icon: "kanban",
  },
  {
    title: "AI 辅助加速",
    description: "每个步骤都配有 AI 使用指南，大幅提升工作效率",
    icon: "ai",
  },
  {
    title: "PRD 文档库",
    description: "统一管理所有需求说明书，支持标签分类和搜索",
    icon: "docs",
  },
  {
    title: "即用型模板",
    description: "数据字典、场景说明等模板开箱即用，无需从零开始",
    icon: "template",
  },
  {
    title: "轻量级设计",
    description: "5 分钟上手，学习成本极低，专注于产出而非工具",
    icon: "lightweight",
  },
];
