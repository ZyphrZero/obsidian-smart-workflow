import type { App, EventRef} from 'obsidian';
import { Notice, ButtonComponent, TextAreaComponent, MarkdownRenderer, setIcon, Menu, Component } from 'obsidian';
import type { ChatService } from '../../services/chat/chatService';
import type { VoiceInputService, DictationResult } from '../../services/voice/voiceInputService';
import { t } from '../../i18n';

export const CHAT_VIEW_TYPE = 'smart-workflow-chat-view';

// --- Mock Data ---

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
}

interface ChatSession {
    id: string;
    title: string;
    lastActive: number;
    preview: string;
}

const MOCK_HISTORY: ChatSession[] = [
    { id: 'h1', title: 'React Component Help', lastActive: Date.now() - 3600000, preview: 'How do I create a functional component with hooks?' },
    { id: 'h2', title: 'Code Refactoring', lastActive: Date.now() - 86400000, preview: 'Can you optimize this loop for better performance?' },
    { id: 'h3', title: 'Bug Fix: Null Pointer', lastActive: Date.now() - 172800000, preview: 'I am getting "undefined is not an object" in line 42.' },
    { id: 'h4', title: 'Project Planning', lastActive: Date.now() - 259200000, preview: 'Let\'s outline the roadmap for Q4 features.' },
    { id: 'h5', title: 'CSS Flexbox Guide', lastActive: Date.now() - 604800000, preview: 'How to center a div vertically and horizontally?' },
    { id: 'h6', title: 'Rust Ownership', lastActive: Date.now() - 1209600000, preview: 'Explain the concept of borrowing in Rust.' },
    { id: 'h7', title: 'API Design', lastActive: Date.now() - 2419200000, preview: 'What are the best practices for RESTful API versioning?' },
];

const MOCK_SESSIONS: ChatSession[] = [
    { id: '1', title: 'Current Task', lastActive: Date.now(), preview: 'Working on the chat UI optimization.' },
    { id: '2', title: 'Daily Notes', lastActive: Date.now() - 1800000, preview: 'Summarize my meetings for today.' }
];

const INITIAL_WELCOME_MESSAGE: ChatMessage = {
    role: 'assistant',
    content: "# Welcome to Smart Chat! \n\nI'm here to help you with your coding, writing, and planning tasks. \n\n**You can ask me to:**\n- Explain complex code\n- Refactor functions\n- Generate documentation\n- Brainstorm ideas\n\n*Type a message below to get started!*",
    timestamp: Date.now()
};

// --- Chat View Class (不继承 ItemView，由 Wrapper 管理) ---

export class ChatView extends Component {
  private app: App;
  private containerEl: HTMLElement;
  private chatService: ChatService;
  private voiceInputService: VoiceInputService | null = null;
  private messageContainer: HTMLElement;
  private inputContainer: HTMLElement;
  private historyContainer: HTMLElement;
  private isHistoryOpen: boolean = false;
  private messageEventRef: EventRef | null = null;
  
  // Header Elements
  private headerTitle: HTMLElement;
  private headerSessionBar: HTMLElement;
  private historyBtn: HTMLElement;
  
  private inputComponent: TextAreaComponent;
  private loadingIndicator: HTMLElement | null = null;
  private voiceBtn: ButtonComponent | null = null;

  // Session Management
  private activeSessions: ChatSession[] = [];
  private currentSessionId: string = '1';
  private sessionMessages: Map<string, ChatMessage[]> = new Map();

  constructor(app: App, containerEl: HTMLElement, chatService: ChatService, voiceInputService?: VoiceInputService) {
    super();
    this.app = app;
    this.containerEl = containerEl;
    this.chatService = chatService;
    this.voiceInputService = voiceInputService || null;
    
    // Initialize Mock Data
    this.activeSessions = [...MOCK_SESSIONS];
    
    // Initialize messages for active sessions
    this.sessionMessages.set('1', [INITIAL_WELCOME_MESSAGE]);
    this.sessionMessages.set('2', [
        { role: 'user', content: 'Summarize my meetings for today.', timestamp: Date.now() - 1800000 },
        { role: 'assistant', content: 'You have a team sync at 10:00 AM and a project review at 2:00 PM.', timestamp: Date.now() - 1799000 }
    ]);
  }

  async render(): Promise<void> {
    const container = this.containerEl;
    container.empty();
    container.addClass('smart-chat-view');
    
    // 1. Header Area
    this.renderHeader(container);

    // 2. Main Content Area (Stackable)
    const contentArea = container.createDiv('chat-content-area');

    // Message History Area
    this.messageContainer = contentArea.createDiv('chat-message-container');

    // History View Area (Hidden by default)
    this.historyContainer = contentArea.createDiv('chat-history-container');
    this.historyContainer.hide();

    // 3. Input Area
    this.renderInputArea(container);

    // Subscribe to messages
    this.messageEventRef = this.chatService.on('message', (msg: any) => {
        this.hideLoading();
        this.appendMessage({ ...msg, timestamp: Date.now() });
    });
    
    // Initial Render
    this.renderCurrentSession();
  }

  private renderHeader(container: HTMLElement) {
      const headerToolbar = container.createDiv('chat-view-header-toolbar');
      
      // Top Row: Navigation & Actions
      const headerTop = headerToolbar.createDiv('chat-header-top');
      
      // Left: Sidebar Toggle
      const leftGroup = headerTop.createDiv('chat-header-left-group');
      this.historyBtn = leftGroup.createEl('button', { cls: 'clickable-icon chat-header-btn' });
      setIcon(this.historyBtn, 'history');
      this.historyBtn.setAttr('aria-label', t('chat.history') || 'Conversations');
      this.historyBtn.onclick = () => this.toggleHistory();

      // Center: Title / Status
      const titleGroup = headerTop.createDiv('chat-header-title-group');
      this.headerTitle = titleGroup.createDiv('chat-header-title');
      this.headerTitle.setText('Smart Chat');
      
      // Right: Actions
      const rightGroup = headerTop.createDiv('chat-header-right-group');
      
      const newChatBtn = rightGroup.createEl('button', { cls: 'clickable-icon chat-header-btn' });
      setIcon(newChatBtn, 'plus-square');
      newChatBtn.setAttr('aria-label', t('chat.newChat') || 'New Chat');
      newChatBtn.onclick = () => this.createNewSession();

      const moreBtn = rightGroup.createEl('button', { cls: 'clickable-icon chat-header-btn' });
      setIcon(moreBtn, 'more-vertical');
      moreBtn.setAttr('aria-label', t('common.more') || 'More Options');
      moreBtn.onclick = (e) => this.showMoreMenu(e);

      // Bottom Row: Session Tabs (Scrollable)
      this.headerSessionBar = headerToolbar.createDiv('chat-session-bar');
      this.renderSessionTabs();
  }

  private renderSessionTabs() {
      this.headerSessionBar.empty();
      
      this.activeSessions.forEach(session => {
          const tab = this.headerSessionBar.createDiv('chat-session-tab');
          if (session.id === this.currentSessionId) {
              tab.addClass('is-active');
          }
          
          const icon = tab.createSpan('chat-tab-icon');
          setIcon(icon, 'message-square');
          
          const title = tab.createSpan('chat-tab-title');
          title.setText(session.title);
          
          const close = tab.createSpan('chat-tab-close');
          setIcon(close, 'x');
          close.onclick = (e) => {
              e.stopPropagation();
              this.closeSession(session.id);
          };

          tab.onclick = () => this.switchSession(session.id);
      });
  }

  private renderInputArea(container: HTMLElement) {
      this.inputContainer = container.createDiv('chat-input-container');
      const inputWrapper = this.inputContainer.createDiv('chat-input-wrapper');

      // Text Area
      this.inputComponent = new TextAreaComponent(inputWrapper);
      this.inputComponent.inputEl.addClass('chat-input-textarea');
      this.inputComponent.setPlaceholder(t('chat.placeholder') || 'Ask AI...');
      this.inputComponent.inputEl.rows = 1;

      // Auto-resize
      this.inputComponent.inputEl.addEventListener('input', () => {
          this.inputComponent.inputEl.style.height = 'auto';
          this.inputComponent.inputEl.style.height = `${Math.min(this.inputComponent.inputEl.scrollHeight, 150)}px`;
      });

      // Handle Enter
      this.inputComponent.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          if (e.isComposing) return;
          e.preventDefault();
          this.handleSend();
        }
      });
      
      // Voice
      if (this.voiceInputService) {
          this.voiceBtn = new ButtonComponent(inputWrapper);
          this.voiceBtn.setIcon('mic');
          this.voiceBtn.setClass('chat-voice-btn');
          this.voiceBtn.setTooltip(t('commands.voiceDictation') || 'Voice Dictation');
          this.voiceBtn.onClick(() => this.handleVoiceClick());
      }

      // Send
      const sendBtn = new ButtonComponent(inputWrapper);
      sendBtn.setIcon('send');
      sendBtn.setClass('chat-send-btn');
      sendBtn.setTooltip(t('common.confirm') || 'Send');
      sendBtn.onClick(() => this.handleSend());
  }

  private showMoreMenu(event: MouseEvent) {
      const menu = new Menu();
      menu.addItem((item) =>
          item
              .setTitle('Clear Chat')
              .setIcon('trash')
              .onClick(() => {
                  this.sessionMessages.set(this.currentSessionId, []);
                  this.renderCurrentSession();
              })
      );
      menu.addItem((item) =>
          item
              .setTitle('Settings')
              .setIcon('settings')
              .onClick(() => {
                  new Notice('Settings not implemented yet');
              })
      );
      menu.showAtMouseEvent(event);
  }

  private switchSession(id: string) {
      if (this.currentSessionId === id) return;
      this.currentSessionId = id;
      this.renderSessionTabs();
      this.renderCurrentSession();
      
      // Update header title based on session
      const session = this.activeSessions.find(s => s.id === id);
      if (session) {
          this.headerTitle.setText(session.title);
      }
  }

  private createNewSession() {
      const newId = Date.now().toString();
      const newSession: ChatSession = { 
          id: newId, 
          title: 'New Chat', 
          lastActive: Date.now(),
          preview: ''
      };
      
      this.activeSessions.push(newSession);
      this.sessionMessages.set(newId, [INITIAL_WELCOME_MESSAGE]);
      this.switchSession(newId);
  }

  private closeSession(id: string) {
      this.activeSessions = this.activeSessions.filter(s => s.id !== id);
      this.sessionMessages.delete(id);
      
      if (this.activeSessions.length === 0) {
          this.createNewSession();
      } else if (this.currentSessionId === id) {
          this.switchSession(this.activeSessions[this.activeSessions.length - 1].id);
      } else {
          this.renderSessionTabs();
      }
  }

  private toggleHistory() {
      this.isHistoryOpen = !this.isHistoryOpen;

      if (this.isHistoryOpen) {
          this.messageContainer.hide();
          this.inputContainer.hide();
          this.headerSessionBar.hide();
          this.historyContainer.show();
          this.renderHistoryList();
          this.headerTitle.setText('History');
          setIcon(this.historyBtn, 'arrow-left');
          this.historyBtn.setAttr('aria-label', 'Back');
      } else {
          this.historyContainer.hide();
          this.messageContainer.show();
          this.inputContainer.show();
          this.headerSessionBar.show();
          const session = this.activeSessions.find(s => s.id === this.currentSessionId);
          this.headerTitle.setText(session ? session.title : 'Smart Chat');
          setIcon(this.historyBtn, 'history');
          this.historyBtn.setAttr('aria-label', t('chat.history') || 'Conversations');
      }
  }

  private renderHistoryList() {
      this.historyContainer.empty();

      const searchContainer = this.historyContainer.createDiv('history-search-wrapper');
      const searchIcon = searchContainer.createDiv('history-search-icon');
      setIcon(searchIcon, 'search');
      searchContainer.createEl('input', {
          type: 'text',
          placeholder: 'Search conversations...',
          cls: 'history-search-input'
      });

      const listContainer = this.historyContainer.createDiv('history-list-wrapper');
      
      const allSessions = [...this.activeSessions, ...MOCK_HISTORY].sort((a, b) => b.lastActive - a.lastActive);

      if (allSessions.length === 0) {
          listContainer.createDiv('history-empty-state').setText('No history found.');
          return;
      }

      // Group by date (Today, Yesterday, Older)
      const grouped: {[key: string]: ChatSession[]} = {
          'Today': [],
          'Yesterday': [],
          'Older': []
      };

      const now = new Date();
      allSessions.forEach(s => {
          const date = new Date(s.lastActive);
          const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 3600 * 24));
          
          if (diffDays === 0) grouped['Today'].push(s);
          else if (diffDays === 1) grouped['Yesterday'].push(s);
          else grouped['Older'].push(s);
      });

      for (const [group, sessions] of Object.entries(grouped)) {
          if (sessions.length === 0) continue;
          
          listContainer.createDiv('history-group-header').setText(group);
          
          sessions.forEach(session => {
            const item = listContainer.createDiv('history-list-item');

            const iconDiv = item.createDiv('history-item-icon');
            setIcon(iconDiv, 'message-square');

            const content = item.createDiv('history-item-content');
            content.createDiv('history-item-title').setText(session.title);
            content.createDiv('history-item-preview').setText(session.preview);

            const meta = item.createDiv('history-item-meta');
            meta.createSpan('history-item-date').setText(this.formatTime(session.lastActive));

            item.onclick = () => {
                // If in active sessions, switch to it
                if (this.activeSessions.find(s => s.id === session.id)) {
                    this.switchSession(session.id);
                } else {
                    // Restore from history (Mock)
                    this.activeSessions.push(session);
                    // Mock recovering messages
                    this.sessionMessages.set(session.id, [
                        { role: 'user', content: session.preview, timestamp: session.lastActive },
                        { role: 'assistant', content: 'Here is the information you requested...', timestamp: session.lastActive + 1000 }
                    ]);
                    this.switchSession(session.id);
                }
                this.toggleHistory();
            };
          });
      }
  }

  private renderCurrentSession() {
      this.messageContainer.empty();
      const messages = this.sessionMessages.get(this.currentSessionId) || [];
      
      if (messages.length === 0) {
          this.renderEmptyState();
      } else {
          messages.forEach(msg => this.appendMessage(msg, false)); // Don't scroll on initial render
          this.scrollToBottom();
      }
  }

  private renderEmptyState() {
      const emptyState = this.messageContainer.createDiv('chat-empty-state');
      const icon = emptyState.createDiv('empty-state-icon');
      setIcon(icon, 'bot');
      emptyState.createDiv('empty-state-title').setText('How can I help you today?');
      emptyState.createDiv('empty-state-desc').setText('Ask me anything about your notes, code, or projects.');
  }

  private formatDate(timestamp: number): string {
      return new Date(timestamp).toLocaleDateString();
  }

  private formatTime(timestamp: number): string {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private async handleVoiceClick() {
      if (!this.voiceInputService || !this.voiceBtn) return;

      try {
          if (this.voiceInputService.isRecording()) {
              this.voiceBtn.setIcon('mic');
              this.voiceBtn.buttonEl.removeClass('is-recording');
              const result: DictationResult = await this.voiceInputService.executeDictationFlow();
              if (result && result.processedText) {
                  const currentText = this.inputComponent.getValue();
                  const newText = currentText ? `${currentText} ${result.processedText}` : result.processedText;
                  this.inputComponent.setValue(newText);
              }
          } else {
              await this.voiceInputService.startDictation();
              this.voiceBtn.setIcon('mic-off');
              this.voiceBtn.buttonEl.addClass('is-recording');
              new Notice('Listening...');
          }
      } catch (error) {
          new Notice(`Voice Error: ${error}`);
          this.voiceBtn.setIcon('mic');
          this.voiceBtn.buttonEl.removeClass('is-recording');
      }
  }

  private async handleSend() {
    const content = this.inputComponent.getValue().trim();
    if (!content) return;

    this.inputComponent.setValue('');
    this.inputComponent.inputEl.style.height = 'auto'; 

    this.showLoading();
    
    // In a real app, we would await the response. 
    // Here we assume the service emits 'message' events.
    await this.chatService.sendMessage(content);
  }

  private addMessageToSession(sessionId: string, message: ChatMessage) {
      if (!this.sessionMessages.has(sessionId)) {
          this.sessionMessages.set(sessionId, []);
      }
      this.sessionMessages.get(sessionId)?.push(message);
      
      // Update session title if it's the first user message
      const session = this.activeSessions.find(s => s.id === sessionId);
      if (session && session.title === 'New Chat' && message.role === 'user') {
          session.title = message.content.substring(0, 20) + (message.content.length > 20 ? '...' : '');
          session.preview = message.content;
          this.renderSessionTabs();
          this.headerTitle.setText(session.title);
      }
  }

  private showLoading() {
      if (this.loadingIndicator) return;
      this.loadingIndicator = this.messageContainer.createDiv('chat-message-loading');
      const dots = this.loadingIndicator.createDiv('typing-indicator');
      dots.createSpan();
      dots.createSpan();
      dots.createSpan();
      this.scrollToBottom();
  }

  private hideLoading() {
      if (this.loadingIndicator) {
          this.loadingIndicator.remove();
          this.loadingIndicator = null;
      }
  }

  private async appendMessage(message: ChatMessage, scroll = true) {
    // If receiving a message from service (not typed), add it to history
    if (!this.sessionMessages.get(this.currentSessionId)?.includes(message)) {
        // Check if it's a real new message (simple check)
        const lastMsg = this.sessionMessages.get(this.currentSessionId)?.last();
        if (lastMsg !== message) {
             this.addMessageToSession(this.currentSessionId, message);
        }
    }

    const msgWrapper = this.messageContainer.createDiv(`chat-message-wrapper ${message.role}`);
    
    // Avatar
    const avatar = msgWrapper.createDiv('chat-message-avatar');
    setIcon(avatar, message.role === 'user' ? 'user' : 'bot');

    // Bubble
    const bubble = msgWrapper.createDiv('chat-message-bubble');
    
    // Meta (Name + Time)
    const meta = bubble.createDiv('chat-message-meta');
    const senderSpan = meta.createSpan('chat-message-sender');
    senderSpan.setText(message.role === 'user' ? 'You' : 'Assistant');
    meta.createSpan('chat-message-time').setText(' • ' + this.formatTime(message.timestamp));

    // Content
    const contentDiv = bubble.createDiv('chat-message-content markdown-preview-view');
    await MarkdownRenderer.render(this.app, message.content, contentDiv, '', this);

    if (scroll) this.scrollToBottom();
  }
  
  private scrollToBottom() {
      // Use setTimeout to allow DOM update
      setTimeout(() => {
          this.messageContainer.scrollTo({ top: this.messageContainer.scrollHeight, behavior: 'smooth' });
      }, 50);
  }

  async destroy(): Promise<void> {
    if (this.messageEventRef) {
        this.chatService.offref(this.messageEventRef);
        this.messageEventRef = null;
    }
    this.unload();
  }
}
