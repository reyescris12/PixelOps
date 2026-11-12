import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ThemeId } from '../context/ThemeContext';
import { SpriteVariant, SPRITE_VARIANTS } from '../context/CrewContext';
import type { StationPose, SpriteAnimationState } from './spriteWorld';
/**
 * Reusable Pixel-Art Sprite Renderer that accepts `spriteVariant` and `spriteState` props
 * and uses a 4-phase sprite walking cycle (`walk_1` -> `stand` -> `walk_2` -> `stand`) when moving.
 */
export const AgentSpriteFigure: React.FC<{
  spriteVariant: SpriteVariant;
  pose: StationPose;
  walkFrame: 0 | 1 | 2 | 3;
  facing: 'left' | 'right';
  isMoving?: boolean;
  isWalkingTransition?: boolean;
  spriteState?: SpriteAnimationState;
  isExecuting?: boolean;
  themeId?: ThemeId;
  alt: string;
  className?: string;
}> = ({
  spriteVariant,
  pose,
  walkFrame,
  facing,
  isMoving = false,
  isWalkingTransition = false,
  spriteState,
  isExecuting = false,
  themeId = 'green',
  alt,
  className = '',
}) => {
  const variantMeta = SPRITE_VARIANTS[spriteVariant] || SPRITE_VARIANTS.trenchcoat;
  const family = variantMeta.baseSpriteFamily;

  const isWalkingState =
    spriteState === 'walking' ||
    isWalkingTransition ||
    isMoving ||
    pose === 'walk' ||
    pose === 'walking';

  const isWorkAnimationActive = isExecuting || spriteState === 'executing';

  const resolvedSpriteState: SpriteAnimationState = isWalkingState
    ? 'walking'
    : isWorkAnimationActive
    ? 'executing'
    : 'idle';

  // 4-step walking stride cycle: 0 -> walk_1 (left stride), 1 -> stand (pass), 2 -> walk_2 (right stride), 3 -> stand (pass)
  const resolveWalkCycleUrl = (fam: string): string => {
    if (walkFrame === 0) return `/assets/agents/${fam}_walk_1.png`;
    if (walkFrame === 2) return `/assets/agents/${fam}_walk_2.png`;
    return `/assets/agents/${fam}_stand.png`;
  };

  const resolveSpriteUrl = (): string => {
    if (family === 'safecracker') {
      if (isWalkingState) {
        return resolveWalkCycleUrl('safecracker');
      }
      if (isWorkAnimationActive) {
        return '/assets/agents/safecracker_work.png';
      }
      return '/assets/agents/safecracker_stand.png';
    }

    if (family === 'exo_hacker') {
      if (isWalkingState) {
        return resolveWalkCycleUrl('exo_hacker');
      }
      if (isWorkAnimationActive) {
        return '/assets/agents/exo_hacker_work.png';
      }
      return '/assets/agents/exo_hacker_stand.png';
    }

    if (family === 'tactical_tech_ops') {
      if (isWalkingState) {
        return resolveWalkCycleUrl('tactical_tech_ops');
      }
      if (isWorkAnimationActive) {
        return '/assets/agents/tactical_tech_ops_work.png';
      }
      return '/assets/agents/tactical_tech_ops_stand.png';
    }

    const customFamilies = new Set([
      'archivist_crimson',
      'undercover_field',
      'comms_ops',
      'cyber_security',
      'intel_analyst',
      'undercover_infiltration',
      'sleeper_agent',
      'heavy_sniper',
      'crimson_grapple',
      'hazmat_cloak',
      'ghillie_sniper',
      'recon_grey',
      'recon_blue',
      'recon_brown',
    ]);

    if (customFamilies.has(family)) {
      if (isWalkingState) {
        return resolveWalkCycleUrl(family);
      }
      return `/assets/agents/${family}_stand.png`;
    }

    if (family === 'nyx') {
      if (isWalkingState) {
        return resolveWalkCycleUrl('nyx');
      }
      if (isWorkAnimationActive) {
        return '/assets/agents/nyx_work.png';
      }
      return '/assets/agents/nyx_stand.png';
    }

    if (family === 'cipher') {
      if (isWalkingState) {
        return resolveWalkCycleUrl('cipher');
      }
      return '/assets/agents/cipher_stand.png';
    }

    // Default 'vance' family
    if (isWalkingState) {
      return resolveWalkCycleUrl('vance');
    }
    return '/assets/agents/vance_stand.png';
  };

  const isWorkPose = isWorkAnimationActive;
  const shouldFlipLeft =
    facing === 'left' &&
    pose !== 'laptop' &&
    !(family === 'nyx' && isWorkPose && !isWalkingState) &&
    !(
      (family === 'safecracker' || family === 'exo_hacker' || family === 'tactical_tech_ops') &&
      isWorkPose &&
      !isWalkingState
    );

  const getCombinedFilter = () => {
    const parts: string[] = [];
    if (variantMeta.cssFilter && variantMeta.cssFilter !== 'none') {
      parts.push(variantMeta.cssFilter);
    }
    return parts.length > 0 ? parts.join(' ') : 'none';
  };

  return (
    <div
      data-sprite-state={resolvedSpriteState}
      className={`relative select-none pointer-events-none h-full flex items-end justify-center ${className}`}
      style={{
        transform: shouldFlipLeft ? 'scaleX(-1)' : 'none',
      }}
    >
      {/* Framer Motion Pixel Footstep Dust Puffs when in 'walking' state */}
      <AnimatePresence>
        {resolvedSpriteState === 'walking' && (
          <motion.div
            key="walking-dust"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{
              opacity: [0.25, 0.85, 0.2],
              x: [-2, -7, -11],
              y: [0, -2, -4],
              scale: [0.75, 1.1, 0.7],
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 0.36,
              repeat: Infinity,
              ease: 'easeOut',
            }}
            className="absolute bottom-0.5 left-1/4 z-0 flex items-center gap-0.5 pointer-events-none"
          >
            <span
              className="w-1.5 h-1.5 block"
              style={{ backgroundColor: variantMeta.accentHex, opacity: 0.75 }}
            />
            <span className="w-1 h-1 block bg-[#e59838]/70" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Framer Motion Animated Sprite Body Wrapper */}
      <motion.div
        animate={
          resolvedSpriteState === 'walking'
            ? {
                y: [0, -3.5, 0, -2.5, 0],
                rotate: [0, 1.8, 0, -1.4, 0],
                scaleY: [1, 0.97, 1, 0.98, 1],
              }
            : resolvedSpriteState === 'executing'
            ? {
                y: [0, -1.5, 0],
                scale: [1, 1.02, 1],
              }
            : {
                y: 0,
                rotate: 0,
                scaleY: 1,
                scale: 1,
              }
        }
        transition={
          resolvedSpriteState === 'walking'
            ? {
                duration: 0.36,
                repeat: Infinity,
                ease: 'easeInOut',
              }
            : resolvedSpriteState === 'executing'
            ? {
                duration: 0.8,
                repeat: Infinity,
                ease: 'easeInOut',
              }
            : { duration: 0.2 }
        }
        className="relative z-10 h-full w-full flex items-end justify-center"
      >
        {/* Base High-Res Pixel-Art Character Sprite */}
        <img
          src={resolveSpriteUrl()}
          alt={alt}
          referrerPolicy="no-referrer"
          className="h-full w-full max-h-full max-w-none pixelated block select-none object-contain"
          style={{
            aspectRatio: '2 / 3',
            filter: getCombinedFilter(),
          }}
        />
      </motion.div>
    </div>
  );
};
