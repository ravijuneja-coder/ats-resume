import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: 24,
        fontFamily: "system-ui, sans-serif", textAlign: "center",
      }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>Something went wrong</h1>
        <p style={{ fontSize: 15, color: "#666", margin: "0 0 24px", maxWidth: 420 }}>
          The app hit an unexpected error. Your data is safe — reloading the page usually fixes this.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 24px", borderRadius: 8, border: "none",
            background: "#4F46E5", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer",
          }}
        >
          Reload page
        </button>
      </div>
    );
  }
}
