/**
 * i18n 类型定义文件
 * 定义所有翻译键的类型结构，确保类型安全
 */

/**
 * 支持的语言区域
 */
export type SupportedLocale = 'en' | 'zh-CN';

/**
 * 翻译键接口
 * 包含所有可翻译文本的类型定义
 */
export interface TranslationKeys {
  // 通用文本
  common: {
    confirm: string;
    cancel: string;
    save: string;
    delete: string;
    reset: string;
    test: string;
    loading: string;
    success: string;
    error: string;
    warning: string;
    info: string;
    auto: string;
  };

  // 插件信息
  plugin: {
    name: string;
    loadingMessage: string;
    unloadingMessage: string;
  };

  // 命令
  commands: {
    generateAiFilename: string;
    openTerminal: string;
    terminalSearch: string;
    terminalClear: string;
    terminalCopy: string;
    terminalPaste: string;
    terminalFontIncrease: string;
    terminalFontDecrease: string;
    terminalFontReset: string;
    terminalSplitHorizontal: string;
    terminalSplitVertical: string;
    terminalClearBuffer: string;
  };

  // 菜单
  menu: {
    generateAiFilename: string;
  };

  // 侧边栏
  ribbon: {
    aiFilenameTooltip: string;
    terminalTooltip: string;
  };

  // 通知消息
  notices: {
    noOpenFile: string;
    generatingFilename: string;
    filenameGenerated: string;
    renameCancelled: string;
    operationFailed: string;
    connectionSuccess: string;
    connectionFailed: string;
    testingConnection: string;
    configDeleted: string;
    cannotDeleteDefault: string;
    cannotDeleteLast: string;
    cannotDeleteLastModel: string;
    ptyServerStartFailed: string;
    // 终端相关
    terminal: {
      serverStarted: string;
      serverStopped: string;
      serverCrashed: string;
      serverRestarting: string;
      serverRestartFailed: string;
      serverRestartSuccess: string;
      initFailed: string;
      renderFailed: string;
      createFailed: string;
    };
    // 设置相关
    settings: {
      scrollbackRangeError: string;
      heightRangeError: string;
      rendererUpdated: string;
      backgroundColorReset: string;
      foregroundColorReset: string;
      backgroundImageCleared: string;
    };
  };

  // 终端
  terminal: {
    defaultTitle: string;
    renameTerminal: string;
    renameTerminalPlaceholder: string;
    contextMenu: {
      copy: string;
      copyAsPlainText: string;
      paste: string;
      selectAll: string;
      selectLine: string;
      clear: string;
      clearBuffer: string;
      search: string;
      copyPath: string;
      openInExplorer: string;
      newTerminal: string;
      splitTerminal: string;
      splitHorizontal: string;
      splitVertical: string;
      fontSize: string;
      fontIncrease: string;
      fontDecrease: string;
      fontReset: string;
    };
    search: {
      placeholder: string;
      previous: string;
      next: string;
      close: string;
    };
  };

  // 设置标签页
  settings: {
    tabs: {
      general: string;
      naming: string;
      writing: string;
      terminal: string;
      advanced: string;
    };
    header: {
      title: string;
      feedbackText: string;
      feedbackLink: string;
      reload: string;
    };
  };

  // 设置详情
  settingsDetails: {
    general: {
      apiEndpoint: string;
      apiEndpointDesc: string;
      testConnection: string;
      testing: string;
      actualRequestUrl: string;
      apiKey: string;
      apiKeyDesc: string;
      temperature: string;
      temperatureDesc: string;
      maxTokens: string;
      maxTokensDesc: string;
      topP: string;
      topPDesc: string;
      timeout: string;
      timeoutDesc: string;
      // 功能绑定
      featureBindings: string;
      featureBindingsDesc: string;
      noBinding: string;
      namingFeature: string;
      namingFeatureDesc: string;
      currentBindingStatus: string;
      // 供应商管理
      providerManagement: string;
      providerManagementDesc: string;
      addProvider: string;
      editProvider: string;
      deleteProvider: string;
      noProviders: string;
      noModelsToTest: string;
      // 模型管理
      models: string;
      addModel: string;
      editModel: string;
      deleteModel: string;
      copyModelId: string;
      modelIdCopied: string;
      noModels: string;
      dragToReorder: string;
      fetchModels: string;
      fetchingModels: string;
      fetchModelsSuccess: string;
      fetchModelsFailed: string;
      fetchModelsNoApiKey: string;
      fetchModelsInvalidResponse: string;
      fetchModelsEmpty: string;
      selectModels: string;
      selectModelsDesc: string;
      modelCapabilities: string;
      noModelsFound: string;
      addSelectedModels: string;
      modelsAdded: string;
    };
    naming: {
      namingBehavior: string;
      useCurrentFilename: string;
      useCurrentFilenameDesc: string;
      confirmBeforeRename: string;
      confirmBeforeRenameDesc: string;
      analyzeDirectory: string;
      analyzeDirectoryDesc: string;
      promptTemplate: string;
      promptTemplateDesc: string;
      promptVariables: {
        content: string;
        currentFileName: string;
        conditionalBlock: string;
      };
      basePromptTemplate: string;
      basePromptTemplateDesc: string;
      advancedPromptTemplate: string;
      advancedPromptTemplateDesc: string;
      resetToDefault: string;
    };
    terminal: {
      shellSettings: string;
      defaultShell: string;
      defaultShellDesc: string;
      customShellPath: string;
      customShellPathDesc: string;
      customShellPathPlaceholder: string;
      defaultArgs: string;
      defaultArgsDesc: string;
      defaultArgsPlaceholder: string;
      autoEnterVault: string;
      autoEnterVaultDesc: string;
      instanceBehavior: string;
      newInstanceLayout: string;
      newInstanceLayoutDesc: string;
      createNearExisting: string;
      createNearExistingDesc: string;
      focusNewInstance: string;
      focusNewInstanceDesc: string;
      lockNewInstance: string;
      lockNewInstanceDesc: string;
      themeSettings: string;
      useObsidianTheme: string;
      useObsidianThemeDesc: string;
      backgroundColor: string;
      backgroundColorDesc: string;
      foregroundColor: string;
      foregroundColorDesc: string;
      backgroundImage: string;
      backgroundImageDesc: string;
      backgroundImagePlaceholder: string;
      backgroundImageOpacity: string;
      backgroundImageOpacityDesc: string;
      backgroundImageSize: string;
      backgroundImageSizeDesc: string;
      backgroundImagePosition: string;
      backgroundImagePositionDesc: string;
      blurEffect: string;
      blurEffectDesc: string;
      blurAmount: string;
      blurAmountDesc: string;
      textOpacity: string;
      textOpacityDesc: string;
      appearanceSettings: string;
      fontSize: string;
      fontSizeDesc: string;
      fontFamily: string;
      fontFamilyDesc: string;
      fontFamilyPlaceholder: string;
      cursorStyle: string;
      cursorStyleDesc: string;
      cursorBlink: string;
      cursorBlinkDesc: string;
      rendererType: string;
      rendererTypeDesc: string;
      behaviorSettings: string;
      scrollback: string;
      scrollbackDesc: string;
      defaultHeight: string;
      defaultHeightDesc: string;
      pathValid: string;
      pathInvalid: string;
    };
    advanced: {
      performanceAndDebug: string;
      debugMode: string;
      debugModeDesc: string;
      featureVisibility: string;
      featureVisibilityDesc: string;
      aiNamingVisibility: string;
      aiNamingVisibilityDesc: string;
      terminalVisibility: string;
      terminalVisibilityDesc: string;
      showInCommandPalette: string;
      showInCommandPaletteDesc: string;
      showInEditorMenu: string;
      showInEditorMenuDesc: string;
      showInFileMenu: string;
      showInFileMenuDesc: string;
      showInRibbon: string;
      showInRibbonDesc: string;
      showInRibbonTerminalDesc: string;
      showInNewTab: string;
      showInNewTabDesc: string;
    };
  };

  // 模态框
  modals: {
    renameConfirm: {
      title: string;
      oldName: string;
      newName: string;
    };
    deleteConfig: {
      title: string;
      warning: string;
    };
    deleteModel: {
      title: string;
      warning: string;
    };
    // 供应商编辑弹窗
    providerEdit: {
      titleAdd: string;
      titleEdit: string;
      name: string;
      nameDesc: string;
      namePlaceholder: string;
      nameRequired: string;
      endpoint: string;
      endpointDesc: string;
      endpointRequired: string;
      apiKey: string;
      apiKeyDesc: string;
    };
    // 模型编辑弹窗
    modelEdit: {
      titleAdd: string;
      titleEdit: string;
      name: string;
      nameDesc: string;
      nameRequired: string;
      displayName: string;
      displayNameDesc: string;
      // API 格式和推理配置
      apiFormat: string;
      apiFormatDesc: string;
      apiFormatChatCompletions: string;
      apiFormatResponses: string;
      reasoningEffort: string;
      reasoningEffortDesc: string;
      reasoningEffortLow: string;
      reasoningEffortMedium: string;
      reasoningEffortHigh: string;
      showReasoningSummary: string;
      showReasoningSummaryDesc: string;
    };
    // 模型选择弹窗
    modelSelect: {
      title: string;
      desc: string;
      allExist: string;
      selectAll: string;
      addSelected: string;
      searchPlaceholder: string;
      refresh: string;
      refreshing: string;
      noResults: string;
      ungrouped: string;
    };
    // 测试连接选择模型弹窗
    testConnection: {
      title: string;
      desc: string;
      selectModel: string;
    };
  };

  // Shell 选项
  shellOptions: {
    cmd: string;
    powershell: string;
    gitbash: string;
    wsl: string;
    bash: string;
    zsh: string;
    custom: string;
  };

  // 布局选项
  layoutOptions: {
    replaceTab: string;
    newTab: string;
    newLeftTab: string;
    newLeftSplit: string;
    newRightTab: string;
    newRightSplit: string;
    newHorizontalSplit: string;
    newVerticalSplit: string;
    newWindow: string;
  };

  // 光标样式选项
  cursorStyleOptions: {
    block: string;
    underline: string;
    bar: string;
  };

  // 渲染器选项
  rendererOptions: {
    canvas: string;
    webgl: string;
  };

  // 背景图片大小选项
  backgroundSizeOptions: {
    cover: string;
    contain: string;
    auto: string;
  };

  // 背景图片位置选项
  backgroundPositionOptions: {
    center: string;
    top: string;
    bottom: string;
    left: string;
    right: string;
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
  };

  // 文件名服务
  fileNameService: {
    noChangeNeeded: string;
    fileRenamed: string;
    invalidFileName: string;
  };

  // AI 服务
  aiService: {
    apiKeyNotConfigured: string;
    endpointNotConfigured: string;
    endpointEmpty: string;
    configNotFound: string;
    configNotResolved: string;
    providerNotFound: string;
    modelNotFound: string;
    providerApiKeyNotConfigured: string;
    providerEndpointNotConfigured: string;
    requestTimeout: string;
    requestFailed: string;
    requestFailedHint: string;
    invalidApiKeyHint: string;
    errorDetails: string;
    networkError: string;
    responseFormatError: string;
    missingChoices: string;
    missingContent: string;
    missingOutput: string;
    emptyFileName: string;
    parseError: string;
    testApiKeyInvalid: string;
    testEndpointNotFound: string;
    // Responses API 相关错误
    unsupportedApiFormat: string;
    unsupportedApiFormatHint: string;
    invalidReasoningEffort: string;
    responsesApiError: string;
    responsesApiErrorHint: string;
    // AIClient 相关错误
    noProviderConfigured: string;
    invalidApiKey: string;
    invalidEndpoint: string;
    noModelConfigured: string;
  };

  // 终端实例
  terminalInstance: {
    rendererNotSupported: string;
    webglContextLost: string;
    rendererLoadFailed: string;
    instanceDestroyed: string;
    startFailed: string;
    connectionTimeout: string;
    cannotConnect: string;
  };

  // 终端服务
  terminalService: {
    processNotStarted: string;
    portInfoTimeout: string;
    startFailedWithCode: string;
  };

  // 二进制管理器
  binaryManager: {
    unsupportedOS: string;
    unsupportedArch: string;
    builtinBinaryMissing: string;
    cannotGetBinary: string;
    cannotCreateCacheDir: string;
    downloadingBinary: string;
    downloadProgress: string;
    downloadComplete: string;
    checksumFailed: string;
    downloadFailed: string;
    downloadRetrying: string;
    redirectUrlEmpty: string;
    downloadTimeout: string;
    checksumDownloadFailed: string;
    checksumDownloadTimeout: string;
    cannotSetPermission: string;
  };

  // 模型类型
  modelTypes: {
    all: string;
    chat: string;
    image: string;
    embedding: string;
    asr: string;
    tts: string;
    chatDesc: string;
    imageDesc: string;
    embeddingDesc: string;
    asrDesc: string;
    ttsDesc: string;
  };

  // 模型能力
  modelAbilities: {
    vision: string;
    functionCall: string;
    reasoning: string;
    webSearch: string;
    files: string;
    visionDesc: string;
    functionCallDesc: string;
    reasoningDesc: string;
    webSearchDesc: string;
    filesDesc: string;
  };

  // 选中文字工具栏
  selectionToolbar: {
    actions: {
      copy: string;
      search: string;
      createLink: string;
      highlight: string;
      bold: string;
      italic: string;
      strikethrough: string;
      inlineCode: string;
      inlineMath: string;
      clearFormat: string;
      copySuccess: string;
      copyFailed: string;
      searchSuccess: string;
      searchFallback: string;
      searchFailed: string;
      linkCreated: string;
      linkFailed: string;
      highlightAdded: string;
      highlightFailed: string;
    };
    settings: {
      title: string;
      titleDesc: string;
      enabled: string;
      enabledDesc: string;
      minSelectionLength: string;
      minSelectionLengthDesc: string;
      showDelay: string;
      showDelayDesc: string;
      buttonConfig: string;
      buttonConfigDesc: string;
      showLabel: string;
    };
  };

  // 写作功能
  writing: {
    // 菜单项
    menu: {
      writing: string;
      writingTooltip: string;
      polish: string;
      polishTooltip: string;
      condense: string;
      expand: string;
      continue: string;
    };
    // 操作栏按钮
    actions: {
      accept: string;
      acceptTooltip: string;
      reject: string;
      rejectTooltip: string;
      merge: string;
      mergeTooltip: string;
      retry: string;
      retryTooltip: string;
      cancel: string;
    };
    // 状态消息
    status: {
      loading: string;
      streaming: string;
      complete: string;
      error: string;
      editing: string;
    };
    // 错误消息
    errors: {
      noProviderConfigured: string;
      noProviderConfiguredHint: string;
      requestFailed: string;
      requestTimeout: string;
      networkError: string;
      streamInterrupted: string;
      streamInterruptedWithReason: string;
      invalidResponse: string;
    };
    // 设置
    settings: {
      title: string;
      titleDesc: string;
      enabled: string;
      enabledDesc: string;
      polishEnabled: string;
      polishEnabledDesc: string;
      providerBinding: string;
      providerBindingDesc: string;
      promptTemplate: string;
      promptTemplateDesc: string;
      resetPrompt: string;
    };
    // 快捷键提示
    shortcuts: {
      acceptHint: string;
      rejectHint: string;
      mergeHint: string;
    };
    // 思考内容
    thinking: {
      title: string;
    };
  };
}
