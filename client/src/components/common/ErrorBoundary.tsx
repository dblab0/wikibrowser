import React from 'react';

/** 错误边界组件属性 */
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

/** 错误边界组件状态 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React 错误边界组件
 * 捕获子组件树中的 JavaScript 错误，防止整个应用崩溃
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary 捕获到错误:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: '40px',
            color: 'var(--text-primary)',
          }}
        >
          <div
            style={{
              fontSize: '48px',
              marginBottom: '16px',
            }}
          >
            :(
          </div>
          <h2
            style={{
              fontSize: '18px',
              fontWeight: 600,
              marginBottom: '8px',
            }}
          >
            出现了一些问题
          </h2>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              marginBottom: '8px',
              maxWidth: '400px',
              textAlign: 'center',
            }}
          >
            {this.state.error?.message || '发生了未知错误'}
          </p>
          <pre
            style={{
              fontSize: '12px',
              color: 'var(--text-tertiary)',
              marginBottom: '20px',
              maxWidth: '600px',
              overflow: 'auto',
              padding: '12px',
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              maxHeight: '150px',
              width: '100%',
            }}
          >
            {this.state.error?.stack}
          </pre>
          <button
            onClick={this.handleRetry}
            style={{
              padding: '8px 24px',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              background: 'var(--accent)',
              color: 'var(--text-inverse)',
              fontSize: '14px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
