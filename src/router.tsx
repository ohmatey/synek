import { createRouter, Link } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

// Renders for any unmatched path (incl. the browser's /favicon.ico probe), so
// TanStack Router doesn't fall back to its generic <p>Not Found</p> + warning.
function NotFound() {
  return (
    <div className="not-found">
      <h1>This timeline doesn’t exist</h1>
      <p>The page you’re looking for isn’t here.</p>
      <Link to="/timelines/$id" params={{ id: 'default' }}>
        Back to the canvas
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
