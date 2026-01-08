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
    enabled: string;
    disabled: string;
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
    // 语音输入命令
    voiceDictation: string;
    voiceAssistant: string;
    voiceCancel: string;
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
    serverStartFailed: string;
    wsReconnectFailed: string;
    wsReconnectSuccess: string;

  // 聊天界面
  chat: {
    placeholder: string;
    history: string;
    newChat: string;
  };

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
      aiFeatures: string;
      naming: string;
      fileNaming: string;
      tagging: string;
      autoArchive: string;
      writing: string;
      voice: string;
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
      contextLength: string;
      contextLengthDesc: string;
      maxOutputTokens: string;
      maxOutputTokensDesc: string;
      outputTokensWarning: string;
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
      modelBinding: string;
      selectModel: string;
      selectModelDesc: string;
      visibilitySettings: string;
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
      visibilitySettings: string;
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
      // 服务器连接设置
      serverConnection: string;
      serverConnectionDesc: string;
      reconnectMaxAttempts: string;
      reconnectMaxAttemptsDesc: string;
      reconnectInterval: string;
      reconnectIntervalDesc: string;
      resetToDefaults: string;
      resetToDefaultsDesc: string;
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
      preset: string;
      presetDesc: string;
      name: string;
      nameDesc: string;
      namePlaceholder: string;
      nameRequired: string;
      endpoint: string;
      endpointDesc: string;
      endpointRequired: string;
      // 密钥存储模式
      storageMode: string;
      storageModeDesc: string;
      storageModeLocal: string;
      storageModeShared: string;
      // 共享密钥
      sharedSecret: string;
      sharedSecretDesc: string;
      // 本地密钥
      apiKey: string;
      apiKeyDesc: string;
      apiKeyPlaceholder: string;
      manageKeys: string;
      multiKeyCount: string;
    };
    apiKeyManager: {
      title: string;
      desc: string;
      keyCount: string;
      addKey: string;
      addKeyMode: string;
      addSharedKey: string;
      selectSharedSecret: string;
      keyEmpty: string;
      secretIdEmpty: string;
      keyDuplicate: string;
      importHint: string;
      moveUp: string;
      moveDown: string;
      checkHealth: string;
      checkAll: string;
      checkingAll: string;
      checkAllResult: string;
      statusUnknown: string;
      statusChecking: string;
      statusHealthy: string;
      statusUnhealthy: string;
      // 存储模式相关
      modeLocal: string;
      modeShared: string;
      modeLocalBadge: string;
      modeSharedBadge: string;
      modeLocalTooltip: string;
      modeSharedTooltip: string;
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
      translate: string;
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
      enabledShort: string;
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
      // diff 操作
      acceptIncoming: string;
      acceptCurrent: string;
      acceptBoth: string;
      undo: string;
      acceptAll: string;
      acceptAllTooltip: string;
      rejectAll: string;
      rejectAllTooltip: string;
      reset: string;
      apply: string;
      applyTooltip: string;
    };
    // 状态消息
    status: {
      loading: string;
      streaming: string;
      complete: string;
      error: string;
      editing: string;
      computing: string;
    };
    // 进度消息
    progress: {
      resolved: string;
      noChanges: string;
    };
    // 决策标签
    decisions: {
      acceptedIncoming: string;
      keptCurrent: string;
      mergedBoth: string;
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
      fileNotFound: string;
      editorNotFound: string;
      applyFailed: string;
    };
    // 设置
    settings: {
      title: string;
      titleDesc: string;
      enabled: string;
      enabledDesc: string;
      polishEnabled: string;
      polishEnabledDesc: string;
      modelBinding: string;
      selectModel: string;
      selectModelDesc: string;
      promptTemplate: string;
      promptTemplateDesc: string;
      resetPrompt: string;
    };
    // 快捷键提示
    shortcuts: {
      acceptHint: string;
      rejectHint: string;
      mergeHint: string;
      applyHint: string;
      closeHint: string;
    };
    // 思考内容
    thinking: {
      title: string;
    };
    // Diff 视图
    diff: {
      original: string;
      result: string;
    };
    // 选区分组
    selectionGroup: {
      title: string;
    };
    // 应用视图
    applyView: {
      title: string;
    };
  };

  // 翻译功能
  translation: {
    // 模态窗口
    modal: {
      sourceLanguage: string;
      targetLanguage: string;
      originalText: string;
      translatedText: string;
      thinkingProcess: string;
      showOriginal: string;
      hideOriginal: string;
      showThinking: string;
      hideThinking: string;
      translating: string;
      completed: string;
      detectedAs: string;
      copy: string;
      replace: string;
      retry: string;
    };
    // 工具栏
    toolbar: {
      translate: string;
    };
    // 错误消息
    errors: {
      emptyText: string;
      sameLanguage: string;
      noProviderConfigured: string;
      requestFailed: string;
      requestTimeout: string;
      networkError: string;
      detectionFailed: string;
    };
    // 设置
    settings: {
      title: string;
      titleDesc: string;
      modelBinding: string;
      selectModel: string;
      selectModelDesc: string;
      enableLLMDetection: string;
      enableLLMDetectionDesc: string;
      defaultTargetLanguage: string;
      defaultTargetLanguageDesc: string;
      showOriginalByDefault: string;
      showOriginalByDefaultDesc: string;
    };
  };

  // 语音输入功能
  voiceInput: {
    // 错误消息
    noActiveEditor: string;
    alreadyRecording: string;
    notRecording: string;
    serviceDestroyed: string;
    serverNotRunning: string;
    connectionTimeout: string;
    connectionError: string;
    connectionLost: string;
    transcriptionTimeout: string;
    // 成功消息
    textInserted: string;
    textReplaced: string;
    // 空语音命令
    emptyVoiceCommand: string;
    // 悬浮窗状态
    recording: string;
    processing: string;
    success: string;
    cancel: string;
    finish: string;
  };

  // 语音错误处理
  voiceError: {
    // 通用错误
    unknown: string;
    // 录音错误
    microphoneUnavailable: string;
    permissionDenied: string;
    deviceError: string;
    alreadyRecording: string;
    // ASR 错误
    asrNetworkError: string;
    asrAuthFailed: string;
    asrQuotaExceeded: string;
    asrInvalidAudio: string;
    asrTimeout: string;
    asrAllFailed: string;
    // 服务器错误
    serverNotRunning: string;
    connectionLost: string;
    invalidMessage: string;
    // LLM 处理失败对话框
    llmFailed: {
      title: string;
      rawTextLabel: string;
      hint: string;
      useRawText: string;
      retry: string;
    };
  };

  // 标签生成功能
  tagging: {
    // 服务层消息
    service: {
      notEnabled: string;
      emptyContent: string;
      noAIConfig: string;
      generateFailed: string;
    };
    // 设置
    settings: {
      title: string;
      titleDesc: string;
      modelConfig: string;
      modelConfigDesc: string;
      selectModel: string;
      selectModelDesc: string;
      notBound: string;
      currentBinding: string;
      notBoundWarning: string;
      enabled: string;
      enabledDesc: string;
      tagCount: string;
      tagCountDesc: string;
      preserveExisting: string;
      preserveExistingDesc: string;
      autoApply: string;
      autoApplyDesc: string;
      visibility: string;
      commandPalette: string;
      commandPaletteDesc: string;
      editorMenu: string;
      editorMenuDesc: string;
      fileMenu: string;
      fileMenuDesc: string;
      promptTemplate: string;
      promptTemplateDesc: string;
      resetToDefault: string;
      resetToDefaultDesc: string;
    };
    // 弹窗
    modal: {
      title: string;
      titleDesc: string;
      addTag: string;
      existingBadge: string;
      inputPlaceholder: string;
      delete: string;
      cancel: string;
      confirm: string;
    };
    // 命令和菜单
    commands: {
      generateTags: string;
    };
    // 通知消息
    notices: {
      generating: string;
      generated: string;
      applied: string;
      cancelled: string;
      failed: string;
      noTags: string;
    };
  };

  // 智能归档功能
  archiving: {
    // 服务层消息
    service: {
      notEnabled: string;
      emptyContent: string;
      noAIConfig: string;
      folderNotExist: string;
      targetNotExist: string;
      fileExists: string;
      categorizeFailed: string;
      archiveFailed: string;
    };
    // 设置
    settings: {
      title: string;
      titleDesc: string;
      modelConfig: string;
      selectModel: string;
      selectModelDesc: string;
      notBound: string;
      currentBinding: string;
      notBoundWarning: string;
      enabled: string;
      enabledDesc: string;
      baseFolder: string;
      baseFolderDesc: string;
      baseFolderPlaceholder: string;
      minConfidence: string;
      minConfidenceDesc: string;
      createNewCategories: string;
      createNewCategoriesDesc: string;
      confirmBeforeArchive: string;
      confirmBeforeArchiveDesc: string;
      moveAttachments: string;
      moveAttachmentsDesc: string;
      updateLinks: string;
      updateLinksDesc: string;
      visibility: string;
      commandPalette: string;
      commandPaletteDesc: string;
      editorMenu: string;
      editorMenuDesc: string;
      fileMenu: string;
      fileMenuDesc: string;
      promptTemplate: string;
      promptTemplateDesc: string;
      resetToDefault: string;
      resetToDefaultDesc: string;
    };
    // 弹窗
    modal: {
      title: string;
      noSuggestions: string;
      suggestionsDesc: string;
      customPathTitle: string;
      customPathDesc: string;
      customPathPlaceholder: string;
      newBadge: string;
      cancel: string;
      confirm: string;
    };
    // 命令和菜单
    commands: {
      archiveNote: string;
    };
    // 通知消息
    notices: {
      analyzing: string;
      archiving: string;
      archived: string;
      cancelled: string;
      failed: string;
      noCategory: string;
    };
  };

  // 自动归档功能
  autoArchive: {
    // 命令
    commands: {
      autoArchive: string;
    };
    // 设置
    settings: {
      title: string;
      titleDesc: string;
      descriptionHtml: string;
      mainSettings: string;
      enabled: string;
      enabledDesc: string;
      generateTags: string;
      generateTagsDesc: string;
      performArchive: string;
      performArchiveDesc: string;
      excludeFolders: string;
      excludeFoldersDesc: string;
      excludeFoldersPlaceholder: string;
      hotkeyConfig: string;
      hotkeyConfigDesc: string;
      hotkeyDesc: string;
      noHotkeySet: string;
      pressKey: string;
      resetHotkey: string;
      visibility: string;
      commandPalette: string;
      commandPaletteDesc: string;
      editorMenu: string;
      editorMenuDesc: string;
      fileMenu: string;
      fileMenuDesc: string;
    };
    // 通知消息
    notices: {
      processing: string;
      tagsGenerated: string;
      archived: string;
      completed: string;
      failed: string;
      noCategory: string;
    };
  };

  // 语音设置
  voice: {
    settings: {
      // 基本设置
      title: string;
      titleDesc: string;
      enabled: string;
      enabledDesc: string;
      
      // ASR 配置
      asrConfig: string;
      asrConfigDesc: string;
      defaultRecordingMode: string;
      defaultRecordingModeDesc: string;
      primaryASR: string;
      primaryASRDesc: string;
      backupASR: string;
      backupASRDesc: string;
      noBackup: string;
      asrMode: string;
      asrModeDesc: string;
      asrModeHttpOnly: string;
      asrModeRealtime: string;
      asrModeRealtimeDesc: string;
      asrModeHttp: string;
      asrModeHttpDesc: string;
      enableFallback: string;
      enableFallbackDesc: string;
      
      // 文本处理
      removeTrailingPunctuation: string;
      removeTrailingPunctuationDesc: string;
      
      // API Key 输入
      apiKeyGuide: string;
      currentModel: string;
      dashscopeApiKey: string;
      dashscopeApiKeyDesc: string;
      doubaoAppId: string;
      doubaoAppIdDesc: string;
      doubaoAccessToken: string;
      doubaoAccessTokenDesc: string;
      siliconflowApiKey: string;
      siliconflowApiKeyDesc: string;
      siliconflowExistingHint: string;
      siliconflowNoProviderHint: string;
      useSiliconflowFromProvider: string;
      useSiliconflowFromProviderDesc: string;
      apiKeyPlaceholder: string;
      appIdPlaceholder: string;
      accessTokenPlaceholder: string;
      
      // 密钥存储模式
      keyStorageMode: string;
      keyStorageModeDesc: string;
      localKey: string;
      sharedKey: string;
      
      // LLM 后处理
      llmPostProcessing: string;
      llmPostProcessingDesc: string;
      enableLLMPostProcessing: string;
      enableLLMPostProcessingDesc: string;
      useExistingProvider: string;
      useExistingProviderDesc: string;
      selectProviderModel: string;
      selectProviderModelDesc: string;
      llmEndpoint: string;
      llmEndpointDesc: string;
      llmModel: string;
      llmModelDesc: string;
      llmApiKey: string;
      llmApiKeyDesc: string;
      
      // 预设管理
      presetManagement: string;
      presetManagementDesc: string;
      activePreset: string;
      activePresetDesc: string;
      addPreset: string;
      newPresetName: string;
      resetPresets: string;
      presetsReset: string;
      presetName: string;
      presetSystemPrompt: string;
      presetSystemPromptDesc: string;
      
      // AI 助手配置
      assistantConfig: string;
      assistantConfigDesc: string;
      enableAssistant: string;
      enableAssistantDesc: string;
      useExistingProviderForAssistant: string;
      useExistingProviderForAssistantDesc: string;
      qaSystemPrompt: string;
      qaSystemPromptDesc: string;
      resetQaPrompt: string;
      textProcessingSystemPrompt: string;
      textProcessingSystemPromptDesc: string;
      resetTextProcessingPrompt: string;
      
      // 其他设置
      otherSettings: string;
      otherSettingsDesc: string;
      enableAudioFeedback: string;
      enableAudioFeedbackDesc: string;
      overlayPosition: string;
      overlayPositionDesc: string;
      
      // 历史记录
      historyTitle: string;
      historyDesc: string;
      historySearch: string;
      historySearchPlaceholder: string;
      clearHistory: string;
      historyCleared: string;
      historyEmpty: string;
      historyNoResults: string;
      historyMore: string;
      copyToClipboard: string;
      copiedToClipboard: string;
      viewOriginal: string;
      originalTextLabel: string;
      processedTextLabel: string;
      modeDictation: string;
      modeAssistant: string;
      yesterday: string;
      daysAgo: string;
      
      // 快捷键配置
      hotkeyConfig: string;
      hotkeyConfigDesc: string;
      hotkeyInfo: string;
      dictationCommand: string;
      dictationCommandDesc: string;
      assistantCommand: string;
      assistantCommandDesc: string;
      cancelCommand: string;
      cancelCommandDesc: string;
      openHotkeySettings: string;
      noHotkeySet: string;
      notEnabled: string;
      pressKey: string;
      resetHotkey: string;
    };
    // 状态表盘
    dashboard: {
      asrTitle: string;
      primaryModel: string;
      backupModel: string;
      asrMode: string;
      removePunctuation: string;
      notConfigured: string;
      llmTitle: string;
      activePreset: string;
      llmModel: string;
      llmDisabledHint: string;
      assistantTitle: string;
      assistantModel: string;
      qaMode: string;
      textProcessMode: string;
      supported: string;
      assistantDisabledHint: string;
    };
  };
}
