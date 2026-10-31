import { createVaporApp } from 'vue'; // 构建时别名到 vue36
import { collect } from '../harness.js';
import Parent from './Parent.vue';

const root = document.body.appendChild(document.createElement('div'));
createVaporApp(Parent).mount(root);
window.semantics = () => collect(root);
