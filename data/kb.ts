// Source content for the knowledge base of "Brightbasket Home", a fictional UK homeware e-commerce shop.
// `npm run make:docs` turns this into real files: PDFs, HTML web pages, CSVs and Markdown.

export type KbDoc = { file: string; title: string; type: 'pdf' | 'html' | 'md'; sections: { h: string; p: string[] }[] };

export const SHOP = {
  name: 'Brightbasket Home',
  email: 'help@brightbasket.co.uk',
  phone: '0161 555 0142',
  hours: 'Monday to Friday 8am to 6pm, Saturday 9am to 1pm (UK time). Closed Sundays and bank holidays.',
  address: 'Unit 4, Mill Lane Trading Estate, Stockport, SK4 2AB, United Kingdom',
};

export const DOCS: KbDoc[] = [
  { file: 'returns-and-refunds-policy.pdf', title: 'Returns and Refunds Policy', type: 'pdf', sections: [
    { h: 'Return window', p: ['You can return most items within 30 days of delivery for a full refund.', 'Items must be unused and in their original packaging with all tags attached.', 'The 30-day window starts on the day the courier marks your order as delivered.'] },
    { h: 'Items that cannot be returned', p: ['Personalised or engraved items, opened bedding and pillows (for hygiene reasons), cut-to-length fabrics and gift cards cannot be returned unless they are faulty.'] },
    { h: 'How refunds are paid', p: ['Refunds go back to the original payment method.', 'Once a refund is issued it normally appears on your statement within 5 to 7 working days. PayPal refunds usually appear within 2 working days.'] },
    { h: 'Return postage', p: ['Returns are free for Brightbasket Plus members and for faulty or incorrect items.', 'For other returns we deduct a return label fee of £3.95 from the refund.'] },
    { h: 'Partial refunds', p: ['If only part of an order is returned we refund the items returned. Original delivery charges are refunded only when the whole order is returned within 14 days or the order was faulty.'] },
  ] },
  { file: 'delivery-and-shipping-policy.pdf', title: 'Delivery and Shipping Policy', type: 'pdf', sections: [
    { h: 'Delivery options (UK mainland)', p: ['Standard delivery costs £3.99 and takes 3 to 5 working days.', 'Next-day delivery costs £6.99 when you order before 2pm Monday to Thursday.', 'Standard delivery is free on orders over £50.'] },
    { h: 'Couriers', p: ['We ship with Royal Mail for small parcels and DPD for large or heavy items. You receive a tracking number by email as soon as the parcel leaves our warehouse.'] },
    { h: 'Highlands, islands and Northern Ireland', p: ['Delivery to the Scottish Highlands, Scottish islands, Isle of Man and Northern Ireland takes 5 to 7 working days and costs £7.95.'] },
    { h: 'Late or missing parcels', p: ['If your parcel has not arrived 3 working days after the expected date, contact us and we will open an investigation with the courier.', 'If the courier confirms the parcel is lost we send a replacement or a full refund, whichever you prefer.'] },
  ] },
  { file: 'warranty-policy.pdf', title: 'Product Warranty', type: 'pdf', sections: [
    { h: 'Standard warranty', p: ['All Brightbasket electrical items (kettles, toasters, lamps, fans and heaters) have a 2-year manufacturer warranty from the date of delivery.', 'Furniture has a 1-year warranty against manufacturing defects.'] },
    { h: 'What is not covered', p: ['Normal wear and tear, accidental damage, misuse and damage caused by not following the care instructions are not covered.'] },
    { h: 'Making a warranty claim', p: ['Contact us with your order number and a photo or short video of the fault. If the claim is accepted we repair, replace or refund the item.'] },
  ] },
  { file: 'terms-and-conditions.pdf', title: 'Terms and Conditions', type: 'pdf', sections: [
    { h: 'Order acceptance', p: ['Your order is accepted when we send the dispatch confirmation email. Until then we may cancel an order, for example if an item is out of stock or mispriced.'] },
    { h: 'Cancelling an order', p: ['You can cancel an order free of charge while it is still in "processing" status. Once an order has shipped it cannot be cancelled, but you can return it under the returns policy.'] },
    { h: 'Your statutory rights', p: ['Under the Consumer Contracts Regulations you have 14 days from delivery to cancel most online purchases. Our 30-day return window is in addition to these rights.'] },
    { h: 'Pricing', p: ['All prices are in pounds sterling (GBP) and include VAT at 20%.'] },
  ] },
  { file: 'privacy-policy.pdf', title: 'Privacy Policy', type: 'pdf', sections: [
    { h: 'What we collect', p: ['We collect your name, contact details, delivery address and order history to fulfil orders and provide customer support.'] },
    { h: 'AI-assisted support', p: ['Our customer support uses an AI assistant. Conversations may be reviewed by our customer care team to improve answers. You can ask to speak to a human at any time.'] },
    { h: 'Your rights', p: ['Under UK GDPR you can request a copy of your data or ask us to delete it by emailing privacy@brightbasket.co.uk. We respond within 30 days.'] },
  ] },
  { file: 'product-care-guide.pdf', title: 'Product Care Guide', type: 'pdf', sections: [
    { h: 'Cotton bedding', p: ['Wash cotton bedding at 40°C with similar colours. Tumble dry on low heat and remove promptly to reduce creasing.'] },
    { h: 'Linen', p: ['Wash linen at 30°C on a gentle cycle. Do not tumble dry; line dry and iron while slightly damp.'] },
    { h: 'Ceramic and stoneware', p: ['Our stoneware is dishwasher and microwave safe. Hand-painted ceramics should be hand washed.'] },
    { h: 'Solid wood furniture', p: ['Dust with a dry cloth. Treat with furniture oil every 6 months. Keep away from radiators and direct sunlight.'] },
  ] },

  { file: 'faq.html', title: 'Frequently Asked Questions', type: 'html', sections: [
    { h: 'Do you deliver outside the UK?', p: ['Yes, we deliver to Ireland and most EU countries. See the International Delivery page for prices and times.'] },
    { h: 'Can I change my delivery address?', p: ['Yes, while your order is still processing. Once it has shipped we cannot change the address, but the courier may let you redirect it using the tracking link.'] },
    { h: 'Do you sell gift cards?', p: ['Yes, digital gift cards from £10 to £200. They are valid for 24 months.'] },
    { h: 'How do I contact a person?', p: ['Ask our assistant to connect you to a human, email help@brightbasket.co.uk or call 0161 555 0142 during opening hours.'] },
  ] },
  { file: 'about-us.html', title: 'About Brightbasket Home', type: 'html', sections: [
    { h: 'Who we are', p: ['Brightbasket Home is an independent homeware retailer founded in Stockport in 2016. We sell bedding, kitchenware, lighting, small furniture and home fragrance.'] },
    { h: 'Our warehouse', p: ['All orders are packed at our warehouse at Mill Lane Trading Estate, Stockport.'] },
  ] },
  { file: 'contact-and-opening-hours.html', title: 'Contact Us and Opening Hours', type: 'html', sections: [
    { h: 'Customer care hours', p: ['Our human customer care team is available Monday to Friday 8am to 6pm and Saturday 9am to 1pm (UK time). We are closed on Sundays and bank holidays. The AI assistant answers 24/7.'] },
    { h: 'Phone and email', p: ['Phone: 0161 555 0142. Email: help@brightbasket.co.uk. We reply to emails within 1 working day.'] },
    { h: 'Address', p: ['Brightbasket Home, Unit 4, Mill Lane Trading Estate, Stockport, SK4 2AB.'] },
  ] },
  { file: 'gift-cards.html', title: 'Gift Cards', type: 'html', sections: [
    { h: 'Buying gift cards', p: ['Digital gift cards are available in values from £10 to £200 and are delivered by email within 1 hour.'] },
    { h: 'Using gift cards', p: ['Gift cards are valid for 24 months from purchase and can be used across several orders. They cannot be exchanged for cash.'] },
  ] },
  { file: 'click-and-collect.html', title: 'Click and Collect', type: 'html', sections: [
    { h: 'How it works', p: ['Choose Click and Collect at checkout to collect your order free of charge from our Stockport warehouse shop, usually from the next working day.'] },
    { h: 'Collection rules', p: ['Bring your order confirmation email and photo ID. Orders are held for 14 days before being cancelled and refunded.'] },
  ] },
  { file: 'international-delivery.html', title: 'International Delivery', type: 'html', sections: [
    { h: 'Ireland', p: ['Delivery to the Republic of Ireland costs £9.95 and takes 4 to 6 working days.'] },
    { h: 'European Union', p: ['Delivery to EU countries (for example France, Germany, Spain, Italy and the Netherlands) costs £14.95 and takes 5 to 8 working days. Import duties are included in the price for EU orders.'] },
    { h: 'Rest of the world', p: ['We do not currently ship outside the UK, Ireland and the EU.'] },
  ] },
  { file: 'payment-methods.html', title: 'Payment Methods', type: 'html', sections: [
    { h: 'Accepted payments', p: ['We accept Visa, Mastercard, American Express, PayPal, Apple Pay, Google Pay and Klarna.'] },
    { h: 'Klarna', p: ['Klarna lets you pay in 3 interest-free instalments on orders between £30 and £1,000.'] },
  ] },
  { file: 'price-match.html', title: 'Price Match Promise', type: 'html', sections: [
    { h: 'Our promise', p: ['If you find the identical item cheaper at a UK retailer within 7 days of buying from us, we refund the difference.'] },
    { h: 'Exclusions', p: ['Price match does not apply to marketplace sellers, clearance sales or Black Friday prices.'] },
  ] },
  { file: 'student-discount.html', title: 'Student Discount', type: 'html', sections: [
    { h: 'Discount', p: ['Students get 10% off full-price items when they verify with UNiDAYS. The discount cannot be combined with other promo codes.'] },
  ] },
  { file: 'damaged-or-faulty-items.html', title: 'Damaged or Faulty Items', type: 'html', sections: [
    { h: 'Report within 48 hours', p: ['If an item arrives damaged please report it within 48 hours of delivery with a photo of the item and the packaging.'] },
    { h: 'What happens next', p: ['For damaged or faulty items we offer a free replacement or a full refund including delivery charges. You do not need to pay for return postage.'] },
  ] },
  { file: 'order-tracking-help.html', title: 'Tracking Your Order', type: 'html', sections: [
    { h: 'Order statuses', p: ['Processing means we are picking and packing your order. Shipped means it has left our warehouse and is with the courier. Delivered means the courier has confirmed delivery.'] },
    { h: 'Dispatch times', p: ['Orders placed before 2pm on a working day are usually dispatched the same day.'] },
  ] },
  { file: 'account-help.html', title: 'Account Help', type: 'html', sections: [
    { h: 'Resetting your password', p: ['Use the "Forgot password" link on the sign-in page. The reset link expires after 30 minutes.'] },
    { h: 'Deleting your account', p: ['Email privacy@brightbasket.co.uk to delete your account. Order records are kept for 6 years for tax purposes.'] },
  ] },

  { file: 'brightbasket-plus.md', title: 'Brightbasket Plus Membership', type: 'md', sections: [
    { h: 'What you get', p: ['Brightbasket Plus costs £19 a year and gives free next-day delivery on all orders, free returns and early access to sales.'] },
    { h: 'Cancelling Plus', p: ['You can cancel Plus within 14 days for a full refund if you have not used any Plus benefits.'] },
  ] },
  { file: 'loyalty-points.md', title: 'Loyalty Points', type: 'md', sections: [
    { h: 'Earning points', p: ['You earn 1 point for every £1 spent. 100 points are worth £5 off a future order.'] },
    { h: 'Expiry', p: ['Points expire 12 months after they were earned. Points are removed if the order they were earned on is refunded.'] },
  ] },
  { file: 'black-friday-2026.md', title: 'Black Friday 2026', type: 'md', sections: [
    { h: 'Dates', p: ['Our Black Friday sale runs from Friday 27 November to Monday 30 November 2026 with up to 40% off bedding and lighting.'] },
    { h: 'Returns on sale items', p: ['Items bought in the Black Friday sale have an extended return window until 31 January 2027.'] },
  ] },
  { file: 'sustainability.md', title: 'Sustainability', type: 'md', sections: [
    { h: 'Packaging', p: ['All our packaging is plastic-free and made from recycled cardboard.'] },
    { h: 'Materials', p: ['Our cotton bedding is 100% organic cotton certified to GOTS.'] },
  ] },
];

export const DELIVERY_ZONES = [
  ['zone', 'regions', 'standard_price_gbp', 'standard_days', 'express_available'],
  ['UK mainland', 'England, Wales, Scottish Lowlands', '3.99 (free over 50)', '3-5', 'yes (6.99 next day)'],
  ['UK remote', 'Scottish Highlands and islands, Northern Ireland, Isle of Man', '7.95', '5-7', 'no'],
  ['Ireland', 'Republic of Ireland', '9.95', '4-6', 'no'],
  ['EU', 'EU member states', '14.95', '5-8', 'no'],
];
