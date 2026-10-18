import { SKILL } from './skill.js';

export const name = 'dsh-cu';

export const inject = ['skills'];

export function apply(ctx) {
  ctx.effect(() => ctx.skills.register(SKILL));
}
