import { Component } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/** Catches render failures in a route so one bad screen cannot blank the app. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Route render failed', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="container-x py-20">
        <div className="mx-auto max-w-lg rounded-3xl border border-line bg-white p-8 text-center shadow-card">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <h1 className="display mt-4 text-3xl">Something went sideways.</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            This screen hit an unexpected error. Your booking and account data are safe. Try reloading, or head back to the homepage.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <button type="button" onClick={() => window.location.reload()} className="btn btn-dark">
              <RefreshCw className="h-4 w-4" /> Reload page
            </button>
            <Link to="/" className="btn btn-outline">Back to home</Link>
          </div>
          {import.meta.env.DEV && (
            <pre className="mt-5 max-h-40 overflow-auto rounded-xl bg-paper p-3 text-left text-[0.62rem] text-rose-700">
              {this.state.error?.message || String(this.state.error)}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
