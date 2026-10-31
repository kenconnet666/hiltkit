import { flushSync, mount } from 'svelte';
import { collect } from '../harness.js';
import Parent from './Parent.svelte';

const root = document.body.appendChild(document.createElement('div'));
mount(Parent, { target: root });
flushSync();
window.semantics = () => collect(root);
