// Times and addresses in words: the page's fmtAgo (Sinko web/app.js line 399), and keeping an address left to right inside Arabic.
import { locale, t } from './index';

/**
 * app.js fmtAgo (line 399): "Last online 5 minutes ago", or "Not seen yet". `epoch` and `nowSec` are seconds on the BOX's clock (the page
 * reads serverNowSec()). Without Intl.RelativeTimeFormat (an engine that lacks it) the date and time are written out, as the page does.
 */
export function fmtAgo(epoch: number | null | undefined, nowSec: number): string {
  if (!epoch) return t('neverSeen');
  const diff = Math.round((epoch - nowSec) / 60);
  const RTF = typeof Intl !== 'undefined' ? (Intl as { RelativeTimeFormat?: typeof Intl.RelativeTimeFormat }).RelativeTimeFormat : undefined;
  const rtf = RTF ? new RTF(locale(), { numeric: 'auto' }) : null;
  let txt: string;
  if (!rtf) txt = latinDigits(new Date(epoch * 1000).toLocaleString(locale()));
  else if (diff > -60) txt = latinDigits(rtf.format(diff, 'minute'));
  else if (diff > -1440) txt = latinDigits(rtf.format(Math.round(diff / 60), 'hour'));
  else txt = latinDigits(rtf.format(Math.round(diff / 1440), 'day'));
  return t('lastSeen', { t: txt });
}

/**
 * An address (192.168.1.50, A4:83:E7:12:34:56) or a number inside a sentence, isolated left to right: in Arabic, the colons of a MAC
 * address and the dots of an IP address would otherwise let its parts change places.
 */
export function ltr(s: string): string {
  return s ? '\u2066' + s + '\u2069' : s;
}

/**
 * A name from the network (a device's host name or maker: "Apple, Inc.") isolated in the direction of its own first letter, so its
 * punctuation stays where it belongs inside a line of the other direction. A name can be Arabic too.
 */
export function isolate(s: string): string {
  return s ? '\u2068' + s + '\u2069' : s;
}

/** A time of day, with seconds (for "checked at"). */
export function clockTime(ms: number): string {
  return latinDigits(new Date(ms).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', second: '2-digit' }));
}

/**
 * Latin digits, as the page writes numbers in Arabic too (locale(): ar-BH-u-nu-latn). Hermes does not honour the -u-nu-latn of a locale and
 * writes Arabic-Indic digits (٣:٢٨), so whatever toLocale…String returns goes through this.
 */
export function latinDigits(s: string): string {
  return s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String((d.charCodeAt(0) & 0xf)))
    .replace(/\u066B/g, '.').replace(/\u066C/g, ',');
}
