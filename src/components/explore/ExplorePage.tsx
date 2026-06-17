import { useQuery } from '@tanstack/react-query'
import { listPublicStories, listPublicTimelines, listPublicNodes } from '~/lib/server/explore'
import { HomeContentRow } from '~/components/home/cinematic'
import { PublicStoryCard } from './PublicStoryCard'
import { PublicTimelineCard } from './PublicTimelineCard'
import { PublicNodeCard } from './PublicNodeCard'

// The root `/` Explore feed — a PUBLIC, cross-user discovery surface shown to
// everyone, signed in or out. Three carousels of public content: stories (the
// /s/$slug shareables), timelines (the public canvases), and notable entities.
// Polls so a feed left open picks up freshly-shared work. The only signed-in
// difference lives in the app header (the Projects button), not here.
export function ExplorePage() {
  const { data: stories = [], isLoading: stLoading } = useQuery({
    queryKey: ['public-stories'],
    queryFn: () => listPublicStories(),
    refetchInterval: 60_000,
  })
  const { data: timelines = [], isLoading: tlLoading } = useQuery({
    queryKey: ['public-timelines'],
    queryFn: () => listPublicTimelines(),
    refetchInterval: 60_000,
  })
  const { data: nodes = [], isLoading: ndLoading } = useQuery({
    queryKey: ['public-nodes'],
    queryFn: () => listPublicNodes(),
    refetchInterval: 60_000,
  })

  const loading = stLoading || tlLoading || ndLoading
  const empty = !loading && stories.length === 0 && timelines.length === 0 && nodes.length === 0

  return (
    <div className="ch-home">
      <section className="xp-intro" aria-label="Explore Synek">
        <p className="xp-eyebrow">Explore</p>
        <h1 className="xp-title">Public stories, timelines and ideas</h1>
        <p className="xp-lede">
          A living, time-anchored mesh of events, people and ideas — built by people connecting their AI to
          Synek. Open one, then make your own.
        </p>
      </section>

      {empty ? (
        <div className="ch-rows">
          <div className="ch-row-empty">
            Nothing public yet. Build a timeline, tell its story, and share it — it'll show up here.
          </div>
        </div>
      ) : (
        <div className="ch-rows">
          {(stories.length > 0 || loading) && (
            <HomeContentRow title="Stories">
              {stories.map((s) => (
                <PublicStoryCard key={s.storyId} story={s} />
              ))}
            </HomeContentRow>
          )}

          {timelines.length > 0 && (
            <HomeContentRow title="Timelines">
              {timelines.map((t) => (
                <PublicTimelineCard key={t.id} timeline={t} />
              ))}
            </HomeContentRow>
          )}

          {nodes.length > 0 && (
            <HomeContentRow title="Notable entities">
              {nodes.map((n) => (
                <PublicNodeCard key={n.id} node={n} />
              ))}
            </HomeContentRow>
          )}
        </div>
      )}
    </div>
  )
}
