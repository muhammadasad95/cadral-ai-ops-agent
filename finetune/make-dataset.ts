// Builds the router fine-tuning dataset: customer messages labelled support / orders / escalation.
// Template-based with slot filling, typos, casing and emoji noise; deterministic (seeded) so results are reproducible.
// Output: finetune/data/train.jsonl, finetune/data/test.jsonl (held-out templates + hand-written hard cases).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'data');
mkdirSync(out, { recursive: true });

let s = 42;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

const SLOTS: Record<string, string[]> = {
  product: ['duvet cover', 'kettle', 'toaster', 'floor lamp', 'table lamp', 'dinner set', 'mug', 'pillowcases', 'throw', 'side table', 'bookcase', 'candle', 'reed diffuser', 'casserole dish', 'heater', 'desk fan', 'chopping board', 'accent chair'],
  order: ['BB-10421', 'BB-10388', 'BB-10502', 'BB-10477', 'BB-10399', 'BB-10455', 'BB-10511', 'BB-10432'],
  country: ['Ireland', 'France', 'Germany', 'Spain', 'the Netherlands', 'Italy', 'Northern Ireland', 'the Isle of Man', 'Australia', 'the USA'],
  time: ['last week', 'on Monday', 'ten days ago', 'yesterday', 'a fortnight ago', 'on the 3rd'],
  day: ['Saturday', 'Sunday', 'bank holidays', 'weekdays', 'Boxing Day'],
  method: ['Klarna', 'PayPal', 'Apple Pay', 'Amex', 'Google Pay', 'a gift card'],
  colour: ['white', 'black', 'sage', 'mustard', 'grey', 'navy'],
};
const fill = (t: string) => t.replace(/\{(\w+)\}/g, (_, k) => pick(SLOTS[k]));

const T: Record<'support' | 'orders' | 'escalation', string[]> = {
  support: [
    'How long do I have to return an item?', 'What is your returns policy?', 'How much is next day delivery?', 'Do you deliver to {country}?', 'How long does delivery to {country} take?',
    'Are you open on {day}?', 'What are your opening hours?', 'Can I pay with {method}?', 'Do you sell gift cards?', 'How long are gift cards valid?',
    'Is the {product} dishwasher safe?', 'How do I wash the {product}?', 'Does the {product} come in {colour}?', 'Is the {product} in stock?', 'How much is the {product}?',
    'What warranty does the {product} have?', 'Do you have a student discount?', 'How does Brightbasket Plus work?', 'How do loyalty points work?', 'When is your Black Friday sale?',
    'Do you price match?', 'Can I collect my order in store?', 'Is your packaging plastic free?', 'How do I reset my password?', 'How do I delete my account?',
    'What is your phone number?', 'Can I change my order after placing it?', 'Do refunds go back to my card?', 'How long do refunds take to show?', 'Thanks, that was helpful!',
    'hi there', 'Are your duvet covers organic cotton?', 'What courier do you use?', 'Can I return sale items?', 'Do you charge for returns?',
  ],
  orders: [
    'Where is my order {order}?', 'Has {order} shipped yet?', 'What is the tracking number for {order}?', 'My {product} has not arrived, I ordered it {time}.', 'When will my {product} arrive?',
    'Please cancel order {order}.', 'Can I cancel my {product} order?', 'I need to change the delivery address on {order}.', 'Can you send {order} to my work address instead?', 'I want a refund for the {product}.',
    'The {product} arrived damaged, can I get a refund?', 'My {product} arrived broken.', 'I received the wrong item in {order}.', 'Can I return the {product} I bought {time}?', 'Where is my refund for {order}?',
    'How much did I pay for {order}?', 'Can you list my orders?', 'Is my {product} order delivered?', 'My parcel says delivered but I have not got it.', 'One item is missing from {order}.',
    'start a return for {order} please', 'refund {order}', 'my order hasnt come', 'what did I order {time}?', 'I would like to return the {product}, it is the wrong colour.',
  ],
  escalation: [
    'I want to speak to a manager.', 'Can I talk to a real person please?', 'This is ridiculous, worst service ever!', 'I am going to contact my solicitor about this.', 'My {product} caught fire!',
    'The {product} gave me an electric shock.', 'I will do a chargeback if this is not fixed today.', 'Someone used my account to place {order}, I think I was hacked.', 'I did not place this order, this is fraud.', 'I am reporting you to Trading Standards.',
    'Absolutely disgusting, third time I have complained about {order}.', 'Your bot is useless, get me a human.', 'I burnt my hand on the {product} because it is faulty.', 'I am going to leave a 1 star review everywhere.', 'Stop emailing me, I want my data deleted now or I will complain to the ICO.',
    'My child was hurt by the {product}.', 'This is a joke, I have waited three weeks and nobody replies!!', 'I demand compensation for this nightmare.', 'You have taken money from my account twice and nobody will help.', 'I am disabled and your courier left my {product} in the rain again, this is unacceptable.',
  ],
};

const noise = (x: string) => {
  let y = x;
  if (rnd() < 0.25) y = y.toLowerCase();
  if (rnd() < 0.15) y = y.replace(/[.?!]$/, '');
  if (rnd() < 0.12) y = y.replace(/ the /, ' teh ').replace('receive', 'recieve');
  if (rnd() < 0.1) y = 'Hi, ' + y;
  if (rnd() < 0.08) y = y + ' ' + pick(['😡', '🙏', 'thanks', 'asap', '??']);
  return y;
};

const rows = (labels: Record<string, string[]>, perTemplate: number) => Object.entries(labels).flatMap(([label, ts]) =>
  ts.flatMap((t) => Array.from({ length: perTemplate }, () => ({ text: noise(fill(t)), label }))));

// Hold out ~20% of templates entirely, so the test set measures generalisation, not memorisation.
const split = Object.fromEntries(Object.entries(T).map(([k, ts]) => [k, ts.filter((_, i) => i % 5 !== 0)])) as typeof T;
const held = Object.fromEntries(Object.entries(T).map(([k, ts]) => [k, ts.filter((_, i) => i % 5 === 0)])) as typeof T;

const HARD = [
  ['What is your refund policy for damaged items?', 'support'], ['My kettle arrived damaged, order BB-10477', 'orders'], ['The kettle is sparking and smells of burning', 'escalation'],
  ['Can you tell me how returns work and start one for BB-10421?', 'orders'], ['How long does a refund take?', 'support'], ['Where is my refund?? It has been 3 weeks, this is unacceptable', 'escalation'],
  ['I love the throw, do you have it in grey?', 'support'], ['ok thanks bye', 'support'], ['My order is late again, why does this always happen', 'orders'], ['I want a human to call me back about my refund', 'escalation'],
  ['do u ship to dublin', 'support'], ['cancel it', 'orders'], ['The lamp I got from you nearly started a fire, I want answers', 'escalation'], ['change address on BB-10388 pls', 'orders'], ['Do you have a shop in Manchester?', 'support'],
] as const;

const dedupe = (a: { text: string; label: string }[]) => [...new Map(a.map((r) => [r.text.toLowerCase(), r])).values()];
const train = dedupe(rows(split, 16)).sort(() => rnd() - 0.5);
const test = dedupe([...rows(held, 6), ...HARD.map(([text, label]) => ({ text, label }))]).filter((r) => !train.some((t) => t.text.toLowerCase() === r.text.toLowerCase())).sort(() => rnd() - 0.5);

writeFileSync(join(out, 'train.jsonl'), train.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(join(out, 'test.jsonl'), test.map((r) => JSON.stringify(r)).join('\n') + '\n');
const count = (a: any[]) => a.reduce((m, r) => ({ ...m, [r.label]: (m[r.label] ?? 0) + 1 }), {} as Record<string, number>);
console.log('train', train.length, count(train), '\ntest', test.length, count(test));
