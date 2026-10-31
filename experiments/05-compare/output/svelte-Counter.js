import 'svelte/internal/disclose-version';
import * as $ from 'svelte/internal/client';

var rest_excludes = new Set(['$$slots', '$$events', '$$legacy', 'label', 'children']);
var root = $.from_html(`<button> <!></button>`);

export default function Counter($$anchor, $$props) {
	// 小组件：状态、派生、动态属性、透传 rest、children
	let rest = $.rest_props($$props, rest_excludes);

	let count = $.state(0);
	let doubled = $.derived(() => $.get(count) * 2);
	var button = root();
	var event_handler = () => $.update(count);

	$.attribute_effect(button, () => ({
		...rest,
		class: ['btn', $.get(doubled) > 4 && 'big'],
		'data-doubled': $.get(doubled),
		onclick: event_handler
	}));

	var text = $.child(button);
	var node = $.sibling(text);

	$.snippet(node, () => $$props.children ?? $.noop);
	$.reset(button);
	$.template_effect(() => $.set_text(text, `${$$props.label ?? ''}: ${$.get(count) ?? ''} / ${$.get(doubled) ?? ''} `));
	$.append($$anchor, button);
}