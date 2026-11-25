# App Store listing — draft (App Store Connect)

Apple's field limits and requirements below are from general knowledge, not re-checked
against Apple's pages today. App Store Connect shows the exact limits as you type.

## Identity
- Bundle ID: `io.github.yoginoit39.greenlit` (permanent once the app record is created)
- Version: 1.0.5 · Build: 1
- Primary language: English (U.S.)
- Devices: iPhone only

## Name (max 30)
Greenlit: Ingredient Scanner
(28 characters. Owner has not confirmed the name: alternatives are "Greenlit: Label Scanner" or keeping "Greenlit: Food Scanner".)

## Subtitle (max 30)
Food, cosmetics, supplements

## Promotional text (max 170)
Scan food, cosmetics, supplements or pet food and see what's in it, checked against your allergies, diet, family and pets, with the source for every flag. Free, no account.

## Keywords (max 100, comma separated, no spaces)
allergy,halal,vegan,gluten,barcode,cosmetics,supplement,vitamins,pet,baby,diabetes,kosher,e-number

## Description
Use the "Full description" text from `store/listing.md` (same app, same wording).

## URLs
- Privacy Policy URL: https://yoginoit39.github.io/safeforme-app/privacy.html
- Support URL: https://yoginoit39.github.io/safeforme-app/support.html
- Marketing URL (optional): https://yoginoit39.github.io/safeforme-app/

## Category
Primary: Food & Drink · Secondary: Health & Fitness

## Price
Free. No in-app purchases.

## Screenshots
`store/app-store-screenshots/` — six images, 1290 × 2796 (6.7-inch iPhone). Made-up products, no real brands.
If App Store Connect asks for a different size, tell Claude and they will be regenerated.

## Age rating questionnaire
Answer None / No to everything (no violence, sexual content, gambling, contests, unrestricted web access, user-generated content).
"Medical/Treatment Information": answer **Infrequent/Mild** — the app shows health-related food information
(allergens, sugar, processing level). This is the honest answer and usually results in a 12+ or lower rating.

## App Privacy ("nutrition label") — suggested answers, you attest to them
- Do you or your third-party partners collect data from this app? **Yes** (cautious answer)
  - Data type: **Photos or Videos** — only when the user photographs a label with their own Google key
  - Used for: **App Functionality**
  - Linked to the user's identity: **No**
  - Used for tracking: **No**
- Nothing else: the profile, history and key stay on the device; no analytics, ads or accounts.
- Why not "Data Not Collected": a label photo is sent to Google's Gemini API. You never receive it, but it leaves the device.

## Export compliance
The build already declares `ITSAppUsesNonExemptEncryption = NO` (only standard HTTPS). No question should appear.

## App Review Information
- Sign-in required: **No**
- Contact: your name, phone and email (visible only to Apple)
- Notes for the reviewer (paste this):

```
Greenlit needs no account. All core features work immediately:
1. Open the app and tap "Start scanning" (or set up a profile first).
2. Tap a sample product under "Try a sample product", or type barcode 3017620422003 and tap Look up.
3. You see how the listed ingredients fit the profile, a personal score for food, and a "Why" explanation with named, linked sources.
   The app describes ingredients against the user's stated needs and published guidance. It does not rate products as safe or unsafe;
   every rule and source is listed at https://yoginoit39.github.io/safeforme-app/how.html
4. "Scan a product" uses the camera to read barcodes on the device.

Two optional extras ("AI extras": photographing a label, and an AI explanation of ingredients)
use Google's Gemini API with the user's own free API key. To test them, go to
Settings > Set up AI extras and paste this review key: <PASTE A GEMINI KEY YOU CREATED FOR APPLE REVIEW>
The key is stored only on the device and sent only to Google.

The app is an information tool, not a medical device, and shows "Not medical advice" on every result.
Product data comes from Open Food Facts (ODbL), attributed in the app.
```

Create a separate Gemini key just for Apple review and paste it into those notes (the notes are private to Apple).
Without a key the reviewer cannot try the optional extras, which is a common reason for rejection ("could not access all features").

## Things Apple may ask about
- **Guideline 4.2 (minimum functionality / web wrapper):** the app uses the camera, works offline for saved scans,
  processes everything on the device and has native haptics. If questioned, say exactly that.
- **Guideline 1.4.1 (health):** information only, no safety verdicts, sources named and linked, disclaimers on every result. Supplement dose checks use official upper intake levels (Health Canada / US National Academies); child guidance restates US CDC and UK NHS pages; infant formula is never scored or compared. Full method: how.html.
- **Guideline 5.1.1 (privacy):** no account, no tracking, privacy policy linked in the app.

## Tonight, in order
1. Install Xcode from the Mac App Store and open it once (accept licence, let it install iOS support).
2. Tell Claude — it builds the app and runs it in the iPhone simulator to check it.
3. In Xcode: Settings > Accounts > add your Apple ID. Open `ios/App/App.xcodeproj`, select the App target >
   Signing & Capabilities > tick "Automatically manage signing" > choose your Team.
4. Plug in your iPhone and run the app on it once (real camera test).
5. Product > Archive > Distribute App > App Store Connect > Upload.
6. appstoreconnect.apple.com > My Apps > + New App (bundle ID above) > fill in this listing > add the build > Submit for Review.
