/**
 * W5-7: the settings Bunny AI knows. PUT /api/settings refuses any other key, so a stray program cannot park its own data (or a key a
 * later version might trust) in the settings file. The keys that decide what Bunny may do are in windowOnly.js; these are the ordinary ones.
 */
export const ORDINARY_SETTING_KEYS = [
  'theme', 'language', 'notifications', 'displayName', 'callName', 'speechVoice', 'defaultEffort', 'providerId', 'model',
  'codeFont', 'codeFontSize', 'codeThemeDark', 'codeThemeLight', 'interfaceFont', 'responseFont', 'motion', 'transcriptSize', 'transcriptWidth', 'uiZoom',
  'artifactsEnabled', 'autoMemory', 'memoryEnabled', 'memorySensitive', 'searchChats', 'summaryNextSteps', 'unrelatedTask', 'branchPrefix',
  'aiDesktopName', 'aiDesktopDesc', 'buildName', 'buildDesc', 'fallbackName', 'fallbackDesc', 'toolsTitle',
];
