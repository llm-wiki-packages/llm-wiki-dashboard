// The start: go to the first wiki, or say there is none.

import { Navigate, createFileRoute } from '@tanstack/react-router'
import { useConfig, useWikis } from '@/lib/api'
import { Empty, ErrorNote, Skeleton } from '@/components/ui'

export const Route = createFileRoute('/')({ component: Start })

function Start() {
  const wikis = useWikis()
  const cfg = useConfig()
  if (wikis.isPending) return <Skeleton className="m-10 h-24 max-w-xl" />
  if (wikis.isError) return <div className="m-10 max-w-xl"><ErrorNote error={wikis.error} /></div>
  const first = wikis.data[0]
  if (first) return <Navigate to="/w/$key" params={{ key: first.key }} replace />
  return (
    <div className="mx-auto max-w-xl p-10">
      <h1 className="text-3xl">{cfg.data?.productName ?? ''}</h1>
      <div className="mt-6">
        <Empty
          title={`No ${cfg.data?.nouns.wiki[1] ?? 'wikis'} registered on this machine`}
          body="Register one with the machine CLI and reload."
        />
      </div>
    </div>
  )
}
