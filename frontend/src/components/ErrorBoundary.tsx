import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode; label?: string }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error) { console.error(`[${this.props.label ?? 'panel'}]`, error) }
  render() {
    if (this.state.error) {
      return (
        <div className="text-[12px] rounded-md px-3 py-2" style={{ background: 'rgba(239,68,68,0.12)', color: '#FCA5A5' }}>
          <div className="font-semibold">{this.props.label ?? 'This panel'} hit an error</div>
          <div className="num opacity-80 mt-0.5">{this.state.error.message}</div>
          <button className="btn mt-2" onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}
