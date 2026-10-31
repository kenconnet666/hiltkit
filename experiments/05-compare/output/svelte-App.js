import 'svelte/internal/disclose-version';
import * as $ from 'svelte/internal/client';
import Counter from './Counter.svelte';

var root = $.from_html(`<b>child</b>`);

export default function App($$anchor) {
	let el = $.state(void 0);

	$.bind_this(
		Counter($$anchor, {
			label: 'n',
			class: 'outer',
			style: 'color: red',
			onclick: () => console.log('outer click'),
			children: ($$anchor, $$slotProps) => {
				var b = root();

				$.append($$anchor, b);
			},
			$$slots: { default: true }
		}),
		($$value) => $.set(el, $$value, true),
		() => $.get(el)
	);
}