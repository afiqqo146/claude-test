# Sisma Showroom Rail

A custom Shopify section for [shop.sismaautohub.com](https://shop.sismaautohub.com/collections/buy).
Cars from a collection hang from a lit showroom track. Customers drag, swipe or
use the arrows to move along the rail. The car in the centre comes forward, its
price tag swings as the rail moves, and its year, mileage, origin and price show
underneath with a **View this car** button.

Built for the store's current theme (Dawn 6.0.2). It works with any Online Store 2.0 theme.

## Files

| File | Goes in |
| --- | --- |
| `sections/sisma-showroom-rail.liquid` | Theme → **Sections** |
| `assets/sisma-showroom-rail.css` | Theme → **Assets** |
| `assets/sisma-showroom-rail.js` | Theme → **Assets** |

## Install

1. In Shopify admin, open **Online Store → Themes**. On your live theme, choose **⋯ → Duplicate** so you can test on a copy first.
2. On the copy, choose **⋯ → Edit code**.
3. Under **Sections**, choose **Add a new section**, name it `sisma-showroom-rail`, and paste in the contents of `sections/sisma-showroom-rail.liquid`, replacing the starter code.
4. Under **Assets**, choose **Add a new asset → Create a blank file**. Make `sisma-showroom-rail.css` and paste in the CSS, then do the same for `sisma-showroom-rail.js`.
5. Save, then open **Customize**. On the page you want (home page, or the Buy collection template), choose **Add section → Showroom rail**.
6. Set **Collection** to *Buy*. Adjust the text, the number of cars and the colours, then save.
7. When you're happy with the copy, choose **Publish** on it.

## How the details are filled in

- **Year, mileage and origin** are read from each listing's description, which already follows the pattern
  `2022 • 7,226 KM • JAPAN IMPORT` (and the `VPR3135 2024 | 1,500 KM` style). If a listing has no
  mileage, the tag shows just the year.
- **Badges** on the photo, in order of priority:
  - a product tag like `badge:Tax reduction` shows that text
  - **Sold** when the car is unavailable
  - **Reduced** when *Compare-at price* is higher than the price
  - **New** for cars published in the last 14 days (changeable, 0 turns it off)

## Section settings

Collection · cars to show (3–30) · starting car · eyebrow and subheading · button labels ·
photo framing (crop to the car, or full square photo) · NEW badge window · background, text
and badge colours.
