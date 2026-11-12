interface LogItem {
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  details?: any;
}

class FrontendLogger {
  private queue: LogItem[] = [];
  private flushTimer: any = null;
  private isInitialized = false;

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Перехват глобальных ошибок браузера
    window.addEventListener('error', (event) => {
      this.error(`[JS Error] ${event.message} at ${event.filename}:${event.lineno}`, {
        col: event.colno,
        stack: event.error?.stack,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.error(`[Unhandled Promise Rejection] ${event.reason?.message || String(event.reason)}`, {
        reason: event.reason,
      });
    });

    this.info(`[Браузер] Фронтенд TANBOX CRM загружен (${navigator.userAgent})`);
  }

  info(message: string, details?: any) {
    this.enqueue('INFO', message, details);
  }

  warn(message: string, details?: any) {
    this.enqueue('WARN', message, details);
  }

  error(message: string, details?: any) {
    this.enqueue('ERROR', message, details);
    this.flush(); // ошибки отправляем немедленно
  }

  private enqueue(level: LogItem['level'], message: string, details?: any) {
    this.queue.push({ level, message, details });
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 1500);
    }
  }

  private flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.queue.length === 0) return;

    const itemsToSend = [...this.queue];
    this.queue = [];

    for (const item of itemsToSend) {
      try {
        fetch('/api/logs/frontend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(item),
        }).catch(() => {});
      } catch {}
    }
  }
}

export const frontendLogger = new FrontendLogger();

