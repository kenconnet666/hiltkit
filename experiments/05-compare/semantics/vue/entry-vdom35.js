import { createApp } from 'vue'; // vue@3.5.44
import { collect } from '../harness.js';
import Parent from './Parent.vue';

const root = document.body.appendChild(document.createElement('div'));
createApp(Parent).mount(root);
window.semantics = () => collect(root);
