'use client'

import type { Requirement } from '@autix/contracts'
import { ListChecks } from 'lucide-react'
import { motion, useReducedMotion, type MotionProps } from 'motion/react'
import { InfoCard } from '@/components/ui/InfoCard'
import { enter } from '@/lib/motion'

export function RequirementCards({ requirements }: { requirements: Requirement[] }) {
  const reduced = useReducedMotion() ?? false
  if (requirements.length === 0) return null
  return (
    <div className="flex w-full max-w-[85%] flex-col gap-2">
      {requirements.map((requirement, index) => (
        <motion.div key={index} data-requirement {...(enter(index, reduced) as MotionProps)}>
          <InfoCard
            icon={<ListChecks size={20} />}
            title={requirement.action}
            subtitle={
              requirement.constraints.length > 0
                ? requirement.constraints.join(' · ')
                : undefined
            }
          />
        </motion.div>
      ))}
    </div>
  )
}
