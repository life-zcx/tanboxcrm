import React from 'react';

export class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="min-h-screen bg-[#F1F5F9] flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md w-full text-center space-y-3">
          <p role="alert" className="text-sm font-semibold text-slate-900">
            Не удалось отобразить страницу.
          </p>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-[#0082FB] text-white text-xs font-semibold hover:bg-[#0070D8]"
            onClick={() => window.location.reload()}
          >
            Обновить страницу
          </button>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}
