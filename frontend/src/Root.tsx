import { lazy, Suspense, useEffect, useState } from 'react'
import App from './App'

const Landing = lazy(() => import('./Landing'))

/** Tiny path router: "/" = landing, "/app" = the app. No auth, no settings. */
export default function Root() {
  const [path, setPath] = useState(() => location.pathname)
  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const go = (to: string) => { history.pushState(null, '', to); setPath(to) }
  if (path === '/' || path === '') {
    return (
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#07120B' }} />}>
        <Landing onEnter={() => go('/app')} />
      </Suspense>
    )
  }
  return <App />
}
