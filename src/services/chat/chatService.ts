import type { App} from 'obsidian';
import { Events, Notice, TFile } from 'obsidian';
import { AIClient } from '../ai/aiClient';
import type { SmartWorkflowSettings } from '../../settings/settings';
import { ConfigManager } from '../config/configManager';
import type { ISecretService } from '../secret';
import type { ServerManager } from '../server/serverManager';
import { t } from '../../i18n';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class ChatService extends Events {
  private app: App;
  private settings: SmartWorkflowSettings;
  private serverManager: ServerManager;
  private configManager: ConfigManager;
  private history: ChatMessage[] = [];
  private aiClient: AIClient | null = null;
  private isProcessing: boolean = false;

  constructor(
    app: App,
    settings: SmartWorkflowSettings,
    serverManager: ServerManager,
    secretService?: ISecretService
  ) {
    super();
    this.app = app;
    this.settings = settings;
    this.serverManager = serverManager;
    this.configManager = new ConfigManager(settings, undefined, secretService);
  }

  getHistory() {
    return this.history;
  }

  async sendMessage(content: string) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // 1. Add user message
      const userMsg: ChatMessage = { role: 'user', content };
      this.history.push(userMsg);
      this.trigger('message', userMsg);

      // 2. Prepare AI Client
      this.ensureAIClient();
      if (!this.aiClient) {
        this.addSystemMessage('No AI Provider/Model configured. Please check settings.');
        this.isProcessing = false;
        return;
      }

      // 3. System Prompt with Tools
      const systemPrompt = `You are a helpful assistant embedded in Obsidian.
You have access to the following tools. To use them, output a JSON block strictly in this format:
\`\`\`json
{ "tool": "tool_name", "parameters": { ... } }
\`\`\`

Available Tools:
- get_current_context: Get the content of the currently active file. Parameters: none.

If you don't need a tool, just respond normally.`;

      await this.processTurn(systemPrompt);

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.addSystemMessage(`Error: ${msg}`);
      new Notice(`Chat Error: ${msg}`);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processTurn(systemPrompt: string) {
    if (!this.aiClient) return;

    // Send Request
    // Note: We pass the FULL history (excluding the one we just added? No, including it).
    // RequestBuilder now supports 'messages'.
    
    // We construct the messages payload for the AI
    // We should NOT include the 'system' messages we generated for errors in the AI context usually,
    // but here we might want to. For simplicity, we send all 'user' and 'assistant' messages.
    const contextMessages = this.history.filter(m => m.role !== 'system');

    const response = await this.aiClient.request({
      messages: contextMessages,
      systemPrompt: systemPrompt,
      stream: false
    });
    
    const responseText = response.content;
    
    // Check for tool call
    // Regex to find ```json { ... } ``` or just { ... } if it looks like a tool call
    const toolCallMatch = responseText.match(/```json\s*({[\s\S]*?"tool"\s*:\s*"get_current_context"[\s\S]*?})\s*```/);
    // Also try simple match if they forgot markdown blocks but output valid json
    const simpleMatch = responseText.match(/({[\s\S]*?"tool"\s*:\s*"get_current_context"[\s\S]*?})/);

    const jsonStr = toolCallMatch ? toolCallMatch[1] : (simpleMatch ? simpleMatch[1] : null);

    if (jsonStr) {
      try {
        const toolData = JSON.parse(jsonStr);
        if (toolData.tool === 'get_current_context') {
          // Add the AI's "Tool Call" message to history
          const aiToolCallMsg: ChatMessage = { role: 'assistant', content: responseText };
          this.history.push(aiToolCallMsg);
          this.trigger('message', aiToolCallMsg);

          // Execute Tool
          this.addSystemMessage('Executing tool: get_current_context...');
          const context = await this.getCurrentFileContext();
          
          // Add Tool Result as a user message (simulating tool return)
          const toolOutputMsg: ChatMessage = { 
            role: 'user', 
            content: `[Tool Output]:\n${context}\n\n(Please continue using this context)`
          };
          this.history.push(toolOutputMsg);
          // We don't necessarily need to show this big blob to the user in the UI, 
          // but for now let's show it so they know what happened.
          // Or we can hide it. Let's show it as 'system' in UI but 'user' in context? 
          // No, keep it simple.
          // let's mark it as a special system message in UI?
          // For now, normal message.
          
          // Recursively call processTurn to get the final answer
          await this.processTurn(systemPrompt);
          return;
        }
      } catch (e) {
         console.warn("Failed to parse tool JSON", e);
         // Fall through to normal response handling
      }
    }

    // Normal response
    const assistantMsg: ChatMessage = { role: 'assistant', content: responseText };
    this.history.push(assistantMsg);
    this.trigger('message', assistantMsg);
  }

  private ensureAIClient() {
    if (this.aiClient) return;
    
    // Try to find a configured provider
    // Logic similar to generic AI setup
    // For now, use the first provider that has models
    const provider = this.settings.providers.find(p => p.models.length > 0);
    if (!provider) return;
    
    const model = provider.models[0];
    
    const resolvedProvider = this.configManager.resolveProviderForRequest(provider);
    if (!resolvedProvider) {
      this.addSystemMessage(t('aiService.invalidApiKey'));
      return;
    }

    this.aiClient = new AIClient({
      provider: resolvedProvider,
      model,
      serverManager: this.serverManager
    });
  }

  private async getCurrentFileContext(): Promise<string> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return "No active file.";
    
    try {
        const content = await this.app.vault.read(activeFile);
        return `File: ${activeFile.path}\n\n${content}`;
    } catch (e) {
        return `Error reading file: ${e}`;
    }
  }

  private addSystemMessage(content: string) {
    const msg: ChatMessage = { role: 'system', content };
    this.history.push(msg);
    this.trigger('message', msg);
  }
  
  clearHistory() {
      this.history = [];
      this.trigger('clear');
  }
}
