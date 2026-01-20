// Simple i18n system to prepare for future languages
// Currently only 'zh' is supported/active.

export const TERMS = {
  zh: {
    common: {
      status: "状态",
      action: "操作",
      loading: "加载中...",
      processing: "处理中...",
      unknown: "未知错误",
      operational: "正常运行",
      connect: "连接",
      disconnect: "断开连接",
      add_new: "添加新服务",
      save: "保存",
      save_success: "保存成功",
      cancel: "取消",
      revoke: "撤销",
      ready: "就绪",
      running: "运行中...",
      search_placeholder: "关键词搜索...",
      prev: "上一页",
      next: "下一页",
      page_info: "第 {current} 页，共 {total} 页",
      disconnect_confirm: "确定要断开 {provider} 的连接吗？",
      editing: "编辑中",
      tokenpulse_logo: "TokenPulse 标志",
      search_logs: "搜索日志",
      service_account_json: "Service Account JSON",
    },
    layout: {
      title: "TokenPulse",
      subtitle: "AI Gateway",
      dashboard: "概览",
      credentials: "凭据",
      logs: "审计日志",
      settings: "系统设置",
      status_label: "运行状态",
      logo_alt: "TokenPulse 标志",
    },
    dashboard: {
      title: "系统仪表盘",
      live_monitor: "实时监控中",
      active_providers: "活跃提供商",
      total_requests: "总请求数",
      avg_latency: "平均延迟",
      uptime: "在线率",
      traffic_chart: "流量趋势",
      provider_usage: "分项消耗",
      token_usage: "消耗详情",
      recent_events: "最近事件",
      no_events: "暂无事件记录",
      view_all: "查看全部日志",
    },
    credentials: {
      title: "凭据管理",
      table_icon: "图标",
      table_provider: "提供商",
      table_type: "类型",
      table_status: "状态",
      table_action: "操作",
      status_connected: "已连接",
      status_disconnected: "未连接",
      type_oauth: "OAuth",
      type_key: "Key",
      input_placeholder: "输入 API Key...",
      toast_redirect: "正在跳转至 {provider} 登录页面...",
      toast_enter_key: "请输入有效的 API Key",
      toast_connected: "{provider} 连接成功！",
      toast_disconnect_confirm: "确定要断开 {provider} 的连接吗？",
      toast_disconnected: "{provider} 已断开连接",
      toast_disconnect_fail: "断开连接失败",
      toast_save_fail: "保存失败: {error}",
      toast_net_error: "网络错误",
      toast_waiting: "等待授权...（几秒后再试）",
      toast_auth_fail: "认证失败",
      toast_poll_fail: "轮询失败",
      toast_start_fail: "启动认证流程失败",
      toast_kiro_fail: "启动 Kiro 认证失败",
      toast_codex_fail: "启动 Codex 认证失败",
      toast_iflow_fail: "启动 iFlow 认证失败",
      toast_gemini_fail: "Gemini 认证失败",
      toast_claude_fail: "Claude 认证失败",
      toast_coming_soon: "即将推出",
      search_providers: "搜索提供商...",
      connect_provider: "连接 {provider}",
      check_status: "检查状态",
      device_instructions:
        '1. 复制下方代码\n2. 点击"打开登录页"\n3. 粘贴代码并授权\n4. 返回此处点击"检查状态"',
      open_login_page: "打开登录页",
      vertex_title: "连接 AI Studio (Vertex)",
      vertex_desc: "请在此处粘贴 Service Account JSON 文件内容。",
      disconnect_default: "确定要断开连接吗？",
    },
    logs: {
      title: "审计日志",
      table_time: "时间戳",
      table_level: "级别",
      table_source: "来源",
      table_msg: "消息内容",
      search_logs: "搜索日志",
    },
    settings: {
      title: "系统设置",
      general_title: "常规配置",
      sys_name: "系统名称",
      maint_mode: "维护模式",
      log_level: "日志级别",
      security_title: "安全配置",
      api_key: "API 密钥",
      token_expiry: "令牌有效期",
      allow_reg: "允许注册",
      provider_title: "提供商策略",
      default_provider: "默认提供商",
      fallback: "故障转移",
      retry: "重试次数",
      toast_load_fail: "加载设置失败",
      toast_save_fail: "保存失败",
      editing: "编辑中",
      saved: "已保存",
    },
    chat: {
      title: "调试沙盒",
      model_select: "模型选择",
      send: "发送",
      thinking_process: "思考过程",
      thinking_placeholder: "模型正在思考...",
      tool_use: "工具调用: {name}",
      tool_result: "工具返回: {name}", // This line is added/modified based on the instruction's snippet
      thinking_config: "思维配置",
      thinking_mode: "思维模式",
      thinking_budget: "Token 预算",
      thinking_level: "思维等级",
      mode_none: "关闭",
      mode_auto: "自动",
      mode_budget: "预算模式",
      mode_level: "等级模式",
      level_minimal: "极简",
      level_low: "低",
      level_medium: "中",
      level_high: "高",
      level_xhigh: "极高",
      tokens: "消耗",
      clear: "清空",
      input_placeholder: "输入你的问题...",
      error: "请求失败",
      latency: "延迟",
    },
  },
};

type Lang = keyof typeof TERMS;
const currentLang: Lang = "zh";

export function t(key: string, params?: Record<string, string>): string {
  const keys = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let value: any = TERMS[currentLang];

  for (const k of keys) {
    if (value && typeof value === "object") {
      value = value[k];
    } else {
      return key; // Fallback to key if not found
    }
  }

  if (typeof value === "string" && params) {
    return value.replace(/\{(\w+)\}/g, (_, k) => params[k] || `{${k}}`);
  }

  return typeof value === "string" ? value : key;
}
