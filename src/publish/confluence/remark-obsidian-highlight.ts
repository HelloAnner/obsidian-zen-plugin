import type { Parent, PhrasingContent } from 'mdast';
import { splice } from 'micromark-util-chunked';
import { classifyCharacter } from 'micromark-util-classify-character';
import { resolveAll } from 'micromark-util-resolve-all';
import type { Construct, Event, Token } from 'micromark-util-types';
import type { Plugin } from 'unified';

declare module 'micromark-util-types' {
	interface TokenTypeMap {
		zenHighlight: 'zenHighlight';
		zenHighlightSequence: 'zenHighlightSequence';
	}
}

declare module 'mdast' {
	interface RootContentMap {
		zenHighlight: Highlight;
	}
	interface PhrasingContentMap {
		zenHighlight: Highlight;
	}
}

interface Highlight extends Parent {
	type: 'zenHighlight';
	children: PhrasingContent[];
}

const equals = 61;
const highlight: Construct = {
	name: 'zenHighlight',
	tokenize(effects, ok, nok) {
		const { previous, events } = this;
		return start;

		function start(code: number | null) {
			if (previous === equals && events[events.length - 1]?.[1].type !== 'characterEscape') return nok(code);
			effects.enter('zenHighlightSequence');
			effects.consume(code);
			return second;
		}

		function second(code: number | null) {
			if (code !== equals) return nok(code);
			effects.consume(code);
			return end;
		}

		function end(code: number | null) {
			if (code === equals) return nok(code);
			const token = effects.exit('zenHighlightSequence');
			token._open = classifyCharacter(code) !== 1;
			token._close = classifyCharacter(previous) !== 1;
			return ok(code);
		}
	},
	resolveAll(events, context) {
		let open = -1;
		for (let i = 0; i < events.length; i++) {
			const [kind, marker] = events[i];
			if (kind !== 'enter' || marker.type !== 'zenHighlightSequence') continue;
			if (marker._close && open !== -1) {
				const start = events[open][1];
				const token: Token = { type: 'zenHighlight', start: { ...start.start }, end: { ...marker.end } };
				const inner = resolveAll(context.parser.constructs.insideSpan.null ?? [], events.slice(open + 2, i), context);
				const replacement: Event[] = [['enter', token, context], ...inner, ['exit', token, context]];
				splice(events, open, i + 2 - open, replacement);
				i = open + replacement.length - 1;
				open = -1;
			} else if (marker._open) {
				open = i;
			}
		}
		for (const [, token] of events) {
			if (token.type === 'zenHighlightSequence') token.type = 'data';
		}
		return events;
	},
};

export const remarkObsidianHighlight: Plugin = function () {
	const data = this.data();
	(data.micromarkExtensions ??= []).push({
		text: { [equals]: highlight },
		insideSpan: { null: [highlight] },
		attentionMarkers: { null: [equals] },
	});
	(data.fromMarkdownExtensions ??= []).push({
		enter: {
			zenHighlight(token) {
				this.enter({ type: 'zenHighlight', children: [], data: { hName: 'mark' } }, token);
			},
		},
		exit: {
			zenHighlight(token) {
				this.exit(token);
			},
		},
	});
};
