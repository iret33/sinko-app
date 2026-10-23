// What the box learned (bin/sinko: Learner, learned_rules, regex_zone): deny regexes "(^|\.)<zone>$" whose comment is
// "pb-learned:<app> <day>", or "pb-learned-no:<app> <day>" once a parent allowed the name again. test/fixtures/learned-rule-cases.json
// (Sinko's tests/fixtures/learned-rule-cases.json) holds the cases both readers must agree on.
//
// Port of Sinko web/pb-core.js, "learned rules" (lines 513-541).
import { isDict } from './state';
import type { LearnedRule } from './types';

// pb-core.js lines 517-518
const LEARNED = 'pb-learned:', UNLEARNED = 'pb-learned-no:';
const ZONE_REGEX = /^\(\^\|\\\.\)((?:[a-z0-9_-]+\\\.)+[a-z0-9_-]+)\$$/;

/** pb-core.js regexZone (line 521): the zone of a rule the box wrote, or null. */
export function regexZone(regex: unknown): string | null {
  const m = typeof regex === 'string' ? ZONE_REGEX.exec(regex) : null;
  return m ? m[1].replace(/\\\./g, '.') : null;
}

/** pb-core.js learnedRules (line 526): [{ app, day, zone, back, enabled, regex, groups }] from the rows of /api/domains. */
export function learnedRules(domains: unknown): LearnedRule[] {
  const out: LearnedRule[] = [];
  (Array.isArray(domains) ? domains : []).forEach((d: unknown) => {
    if (!isDict(d) || typeof d.domain !== 'string' || d.type !== 'deny' || d.kind !== 'regex') return;
    const domain = d.domain;
    const comment = typeof d.comment === 'string' ? d.comment : '';
    ([[LEARNED, false], [UNLEARNED, true]] as const).some((p) => {
      const z = comment.indexOf(p[0]) === 0 ? regexZone(domain) : null;
      if (z === null) return false;
      const parts = comment.slice(p[0].length).split(/\s+/).filter(Boolean);
      out.push({ app: parts[0] || '', day: parts[1] || '', zone: z, back: p[1], enabled: !!d.enabled, regex: domain,
        groups: Array.isArray(d.groups) ? d.groups.filter((g: unknown): g is number => typeof g === 'number' && Math.floor(g) === g) : [] });
      return true;
    });
  });
  return out;
}
