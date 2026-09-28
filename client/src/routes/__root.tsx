import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="mx-auto max-w-xl p-10">
      <h1 className="text-3xl">Nothing here.</h1>
      <p className="mt-2 text-ink-2">
        <a href="/" className="text-accent">
          Back to the start
        </a>
      </p>
    </div>
  ),
})
