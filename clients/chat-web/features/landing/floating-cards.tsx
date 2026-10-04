'use client'
import { FloatingCard } from '@/components/ui/FloatingCard'
import type { TripMock } from '@/features/panels/mock/types'

export function FloatingCards({ data }: { data: TripMock }) {
  const cards = [
    [data.days[0].stops[0].name, data.days[0].stops[0].note],
    [data.hotels[0].name, `€${data.hotels[0].perNight}`],
    [data.route.steps[0].name, data.route.steps[0].note],
    [data.hotspots[0].name, `${data.hotspots[0].emoji} ${data.hotspots[0].count}`],
  ]
  const positions = ['left-[3%] top-[18%]', 'right-[3%] top-[22%]', 'left-[6%] bottom-[10%]', 'right-[5%] bottom-[8%]']
  return <div aria-hidden inert data-testid="floating-cards" className="pointer-events-none absolute inset-0 hidden lg:block">
    {cards.map(([title, note], i) => <FloatingCard key={title} rotate={i % 2 ? 8 : -8} delay={0.5 + i * 0.1}
      className={`absolute w-48 xl:w-56 ${positions[i]}`}>
      <div className="image-placeholder mb-3 h-20 rounded-card" />
      <p className="font-bold">{title}</p><p className="text-sm">{note}</p>
    </FloatingCard>)}
  </div>
}
