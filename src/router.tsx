import { createRouter, Link } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

// Renders for any unmatched path (incl. the browser's /favicon.ico probe), so
// TanStack Router doesn't fall back to its generic <p>Not Found</p> + warning.
function NotFound() {
  return (
    <div className="notfound">
      <h1 className="notfound-title">Not found</h1>
      <p className="notfound-sub">That page doesn’t exist.</p>
      <Link to="/" className="notfound-link">
        ← Back to your timelines
      </Link>
    </div>
  )
}

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFound,
  })
}
