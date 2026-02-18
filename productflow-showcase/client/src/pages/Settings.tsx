import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import type { AiProviderId } from "@shared/ai-providers";
import {
  ArrowLeft,
  Loader2,
  PlugZap,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type ProviderPreset = {
  id: AiProviderId;
  label: string;
  category: "domestic" | "integrator" | "custom";
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  docsUrl?: string;
};

const CATEGORY_LABELS: Record<ProviderPreset["category"], string> = {
  domestic: "国内模型",
  integrator: "聚合平台",
  custom: "自定义",
};

export default function Settings() {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading, isAuthenticated } = useAuth({
    redirectOnUnauthenticated: true,
  });

  const { data: providerPresets, isLoading: providersLoading } =
    trpc.settings.providerPresets.useQuery(undefined, {
      enabled: isAuthenticated,
    });
  const { data: aiConfig, isLoading: configLoading, refetch: refetchAiConfig } =
    trpc.settings.getAiConfig.useQuery(undefined, {
      enabled: isAuthenticated,
    });

  const saveMutation = trpc.settings.saveAiConfig.useMutation({
    onSuccess: async () => {
      toast.success("AI 配置已保存");
      setApiKeyInput("");
      setClearSavedApiKey(false);
      await refetchAiConfig();
    },
    onError: (error) => {
      toast.error(error.message || "保存失败");
    },
  });

  const testMutation = trpc.settings.testAiConfig.useMutation({
    onSuccess: (result) => {
      toast.success(result.preview || "连接测试成功");
    },
    onError: (error) => {
      toast.error(error.message || "测试失败");
    },
  });

  const [selectedProviderId, setSelectedProviderId] = useState<AiProviderId>("custom");
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [clearSavedApiKey, setClearSavedApiKey] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  const presetMap = useMemo(() => {
    const map = new Map<AiProviderId, ProviderPreset>();
    for (const preset of providerPresets ?? []) {
      map.set(preset.id, preset as ProviderPreset);
    }
    return map;
  }, [providerPresets]);

  useEffect(() => {
    if (!aiConfig || hasInitialized) return;
    setSelectedProviderId(aiConfig.providerId);
    setEnabled(aiConfig.enabled);
    setBaseUrl(aiConfig.baseUrl);
    setModel(aiConfig.model);
    setClearSavedApiKey(false);
    setHasInitialized(true);
  }, [aiConfig, hasInitialized]);

  const selectedPreset = presetMap.get(selectedProviderId);
  const groupedPresets = useMemo(() => {
    const groups: Record<ProviderPreset["category"], ProviderPreset[]> = {
      domestic: [],
      integrator: [],
      custom: [],
    };
    for (const preset of providerPresets ?? []) {
      groups[preset.category as ProviderPreset["category"]].push(preset as ProviderPreset);
    }
    return groups;
  }, [providerPresets]);

  const loading = authLoading || providersLoading || configLoading;

  const providerSelectOptions = useMemo(
    () => (["domestic", "integrator", "custom"] as const).map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      items: groupedPresets[category],
    })),
    [groupedPresets]
  );

  const handleSelectProvider = (providerId: AiProviderId) => {
    const preset = presetMap.get(providerId);
    setSelectedProviderId(providerId);
    if (preset) {
      setBaseUrl(preset.defaultBaseUrl);
      setModel(preset.defaultModel);
    }
  };

  const handleSave = async () => {
    if (!baseUrl.trim() || !model.trim()) {
      toast.error("请填写 Base URL 和模型名称");
      return;
    }

    const nextApiKey = apiKeyInput.trim();

    await saveMutation.mutateAsync({
      providerId: selectedProviderId,
      enabled,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKey: nextApiKey || undefined,
      clearApiKey: clearSavedApiKey && !nextApiKey ? true : undefined,
    });
  };

  const handleTest = async () => {
    if (!baseUrl.trim() || !model.trim()) {
      toast.error("请先填写 Base URL 和模型名称");
      return;
    }

    const nextApiKey = apiKeyInput.trim();
    await testMutation.mutateAsync({
      providerId: selectedProviderId,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKey: nextApiKey || undefined,
      useSavedApiKey: !clearSavedApiKey,
    });
  };

  const handleRestoreDefaults = () => {
    if (!selectedPreset) return;
    setBaseUrl(selectedPreset.defaultBaseUrl);
    setModel(selectedPreset.defaultModel);
    toast.success("已恢复当前 Provider 默认配置");
  };

  if (loading) {
    return (
      <div className="pf-page pf-settings-page pf-settings-loading">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--pf-text-secondary)]" />
      </div>
    );
  }

  return (
    <div className="pf-page pf-settings-page">
      <header className="pf-settings-header">
        <div className="pf-settings-head-left">
          <button
            type="button"
            className="pf-settings-back"
            onClick={() => setLocation("/")}
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </button>
          <div className="pf-settings-title-wrap">
            <h1>个人 AI 设置</h1>
            <p>为每位用户配置自己的模型供应商、Base URL、Model 和 API Key。</p>
          </div>
        </div>
        <div className="pf-settings-head-right">
          <span className="pf-settings-user">{user?.name || user?.email || "当前用户"}</span>
          <button
            type="button"
            className="pf-settings-primary"
            onClick={() => {
              void handleSave();
            }}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存配置
          </button>
        </div>
      </header>

      <main className="pf-settings-main">
        <div className="pf-settings-shell">
          <section className="pf-settings-form-panel">
            <div className="pf-settings-section-title">
              <h2>模型接入配置</h2>
              <p>同一个表单完成厂商选择、地址模型填写与密钥管理。</p>
            </div>

            <div className="pf-settings-inline-row">
              <label className="pf-settings-field">
                <span>厂商 / 聚合商</span>
                <select
                  value={selectedProviderId}
                  onChange={(event) => handleSelectProvider(event.target.value as AiProviderId)}
                >
                  {providerSelectOptions.map((group) => (
                    <optgroup key={group.category} label={group.label}>
                      {group.items.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <label className="pf-settings-switch">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                <span>启用个人配置</span>
              </label>
            </div>

            <div className="pf-settings-form-grid">
              <label className="pf-settings-field">
                <span>Base URL</span>
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="例如 https://api.moonshot.cn/v1"
                />
              </label>

              <label className="pf-settings-field">
                <span>Model</span>
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="例如 moonshot-v1-128k"
                />
              </label>
            </div>

            <label className="pf-settings-field">
              <span>API Key（仅你可见）</span>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setApiKeyInput(value);
                  if (value.trim()) {
                    setClearSavedApiKey(false);
                  }
                }}
                placeholder={
                  clearSavedApiKey
                    ? "当前将清空旧 Key，输入新 Key 可替换"
                    : aiConfig?.hasApiKey
                      ? "已保存旧 Key；留空则继续使用"
                      : "请输入你的 API Key"
                }
              />
            </label>

            {aiConfig?.hasApiKey ? (
              <div className="pf-settings-key-row">
                <span>
                  {clearSavedApiKey ? "保存后将清空已保存 API Key。" : "已保存一条 API Key（不会明文展示）。"}
                </span>
                <button
                  type="button"
                  className={`pf-settings-link-btn ${clearSavedApiKey ? "danger" : ""}`}
                  onClick={() => setClearSavedApiKey((prev) => !prev)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {clearSavedApiKey ? "撤销清空" : "清空已保存 Key"}
                </button>
              </div>
            ) : null}

            <div className="pf-settings-actions">
              <button
                type="button"
                className="pf-settings-secondary"
                onClick={handleRestoreDefaults}
                disabled={!selectedPreset}
              >
                <RotateCcw className="h-4 w-4" />
                恢复默认
              </button>
              <button
                type="button"
                className="pf-settings-secondary"
                onClick={() => {
                  void handleTest();
                }}
                disabled={testMutation.isPending}
              >
                {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                测试连接
              </button>
              <button
                type="button"
                className="pf-settings-primary"
                onClick={() => {
                  void handleSave();
                }}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存配置
              </button>
            </div>
          </section>

          <aside className="pf-settings-info-panel">
            <div className="pf-settings-section-title">
              <h2>{selectedPreset?.label ?? "当前厂商"}</h2>
              <p>{selectedPreset?.description || "请选择厂商并填写配置。"}</p>
            </div>

            <div className="pf-settings-note">
              <Sparkles className="h-4 w-4" />
              <p>
                系统基于 OpenAI 兼容协议调用，自动补全
                <code>/chat/completions</code>。API Key 将加密后存储在个人配置中。
              </p>
            </div>

            <div className="pf-settings-provider-meta">
              <div className="pf-settings-meta-row">
                <span>当前模式</span>
                <strong>{enabled ? "个人配置优先" : "平台默认模型"}</strong>
              </div>
              <div className="pf-settings-meta-row">
                <span>默认 Base URL</span>
                <strong>{selectedPreset?.defaultBaseUrl || "-"}</strong>
              </div>
              <div className="pf-settings-meta-row">
                <span>默认模型</span>
                <strong>{selectedPreset?.defaultModel || "-"}</strong>
              </div>
            </div>

            {selectedPreset?.docsUrl ? (
              <a
                className="pf-settings-doc-link"
                href={selectedPreset.docsUrl}
                target="_blank"
                rel="noreferrer"
              >
                查看 {selectedPreset.label} 官方文档
              </a>
            ) : null}

            <div className="pf-settings-provider-hint">
              <span>已支持</span>
              <p>千问、Kimi、智谱、清言、MiniMax、豆包，以及 OpenRouter / SiliconFlow / 302.AI 等聚合商。</p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
