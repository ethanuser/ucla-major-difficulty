#!/usr/bin/env python3
"""
UCLA Catalog Scraper
====================
Scrapes the UCLA General Catalog (catalog.registrar.ucla.edu) to extract:
1. All undergraduate major URLs
2. Required courses for each major

Outputs: ucla_major_requirements.json

Usage:
    python3 scrape_ucla_catalog.py                # Scrape everything
    python3 scrape_ucla_catalog.py --majors-only  # Only scrape major URLs list
    python3 scrape_ucla_catalog.py --resume       # Resume from last checkpoint
"""

import json
import os
import re
import sys
import time
import argparse
from playwright.sync_api import sync_playwright

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)  # Project root (one level up from scripts/)
PROCESSED_DIR = os.path.join(BASE_DIR, 'data', 'processed')
OUTPUT_FILE = os.path.join(PROCESSED_DIR, 'ucla_major_requirements.json')
CHECKPOINT_FILE = os.path.join(PROCESSED_DIR, '.scrape_checkpoint.json')
CATALOG_BASE = 'https://catalog.registrar.ucla.edu'
CATALOG_YEAR = '2025'
SEARCH_URL = f'{CATALOG_BASE}/search'

# ═══════════════════════════════════════════════════════════════════
# STEP 1: Discover all undergraduate major URLs
# ═══════════════════════════════════════════════════════════════════

def discover_major_urls(page):
    """Navigate catalog search, filter for undergrad majors, extract all URLs."""
    print("🔍 Discovering undergraduate major URLs...")
    
    # Go to the search page
    page.goto(SEARCH_URL, wait_until='networkidle', timeout=30000)
    time.sleep(2)
    
    # Click on the "Majors" tab
    page.click('text=Majors', timeout=10000)
    time.sleep(2)
    
    # Try to expand "Degree Level" filter and select "Undergraduate"
    try:
        page.click('text="Degree Level"', timeout=5000)
        time.sleep(1)
        page.click('input[id*="Undergraduate"][id*="_checkbox"]', force=True)
        time.sleep(2)
    except Exception as e:
        print(f"  ⚠ Could not apply filters (may already be showing all): {e}")
    
    # Collect major URLs across all pages
    all_urls = []
    page_num = 0
    
    while True:
        page_num += 1
        print(f"  📄 Scanning page {page_num}...")
        
        # Extract major links from current page
        time.sleep(2)
        links = page.eval_on_selector_all(
            'a',
            '''elements => elements.filter(el => el.href.includes('/major/')).map(el => ({
                name: el.textContent.replace(/\\s+/g, ' ').split('Major |')[0].replace(/^[A-Z0-9]{1,3}\\s+/, '').replace(/^\\d+\\s*/, '').trim(),
                url: el.href
            }))'''
        )
        
        new_urls = [
            link for link in links
            if link['url'] not in [u['url'] for u in all_urls]
            and '/major/20' in link['url']
        ]
        all_urls.extend(new_urls)
        print(f"    Found {len(new_urls)} new majors (total: {len(all_urls)})")
        
        # Try to go to next page
        try:
            next_btn = page.locator('button#pagination-page-next')
            if next_btn.count() > 0 and not next_btn.first.get_attribute("disabled"):
                next_btn.first.click()
                time.sleep(2)
            else:
                break
        except Exception:
            break
    
    # Deduplicate and clean
    seen = set()
    unique_urls = []
    for entry in all_urls:
        url = entry['url'].split('?')[0]  # Remove query params
        if url not in seen:
            seen.add(url)
            unique_urls.append({'name': entry['name'], 'url': url})
    
    print(f"  ✅ Found {len(unique_urls)} unique undergraduate major URLs")
    return unique_urls


def get_fallback_major_urls():
    """Fallback: generate major URLs from known UCLA majors list."""
    print("📋 Using comprehensive UCLA major URL list...")
    
    # Comprehensive list based on UCLA admission website + catalog exploration
    major_slugs = [
        # Engineering
        ('Aerospace Engineering BS', 'AerospaceEngineeringBS'),
        ('Bioengineering BS', 'BioengineeringBS'),
        ('Chemical Engineering BS', 'ChemicalEngineeringBS'),
        ('Civil Engineering BS', 'CivilEngineeringBS'),
        ('Computer Engineering BS', 'ComputerEngineeringBS'),
        ('Computer Science BS', 'ComputerScienceBS'),
        ('Computer Science and Engineering BS', 'ComputerScienceandEngineeringBS'),
        ('Electrical Engineering BS', 'ElectricalEngineeringBS'),
        ('Materials Engineering BS', 'MaterialsEngineeringBS'),
        ('Mechanical Engineering BS', 'MechanicalEngineeringBS'),
        
        # Sciences
        ('Applied Mathematics BS', 'AppliedMathematicsBS'),
        ('Astronomy and Astrophysics BS', 'AstronomyBS'),  
        ('Atmospheric and Oceanic Sciences BS', 'AtmosphericandOceanicSciencesBS'),
        ('Biochemistry BS', 'BiochemistryBS'),
        ('Biology BS', 'BiologyBS'),
        ('Biophysics BS', 'BiophysicsBS'),
        ('Chemistry BS', 'ChemistryBS'),
        ('Chemistry Materials Science BS', 'ChemistryMaterialsScienceBS'),
        ('Climate Science BS', 'ClimateScienceBS'),
        ('Cognitive Science BS', 'CognitiveScienceBS'),
        ('Computational Biology BS', 'ComputationalBiologyBS'),  
        ('Data Theory BS', 'DataTheoryBS'),
        ('Earth and Environmental Science BA', 'EarthandEnvironmentalScienceBA'),
        ('Ecology Behavior and Evolution BS', 'EcologyBehaviorandEvolutionBS'),
        ('Environmental Science BS', 'EnvironmentalScienceBS'),
        ('Geology BS', 'GeologyBS'),
        ('Geology Engineering Geology BS', 'GeologyEngineeringGeologyBS'),
        ('Geophysics BS', 'GeophysicsBS'),
        ('Human Biology and Society BA', 'HumanBiologyandSocietyBA'),
        ('Human Biology and Society BS', 'HumanBiologyandSocietyBS'),
        ('Marine Biology BS', 'MarineBiologyBS'),
        ('Mathematics BS', 'MathematicsBS'),
        ('Mathematics Applied Science BS', 'MathematicsAppliedScienceBS'),
        ('Mathematics Economics BS', 'MathematicsEconomicsBS'),
        ('Mathematics for Teaching BS', 'MathematicsforTeachingBS'),
        ('Mathematics of Computation BS', 'MathematicsofComputationBS'),
        ('Microbiology Immunology and Molecular Genetics BS', 'MicrobiologyImmunologyandMolecularGeneticsBS'),
        ('Molecular Cell and Developmental Biology BS', 'MolecularCellandDevelopmentalBiologyBS'),
        ('Neuroscience BS', 'NeuroscienceBS'),
        ('Physics BA', 'PhysicsBA'),
        ('Physics BS', 'PhysicsBS'),
        ('Physiological Science BS', 'PhysiologicalScienceBS'),
        ('Psychobiology BS', 'PsychobiologyBS'),
        ('Statistics and Data Science BS', 'StatisticsandDataScienceBS'),
        
        # Social Sciences
        ('Anthropology BA', 'AnthropologyBA'),
        ('Anthropology BS', 'AnthropologyBS'),
        ('Business Economics BA', 'BusinessEconomicsBA'),
        ('Communication BA', 'CommunicationBA'),
        ('Economics BA', 'EconomicsBA'),
        ('Geography BA', 'GeographyBA'),
        ('Geography Environmental Studies BA', 'GeographyEnvironmentalStudiesBA'),
        ('Global Studies BA', 'GlobalStudiesBA'),
        ('International Development Studies BA', 'InternationalDevelopmentStudiesBA'),
        ('Political Science BA', 'PoliticalScienceBA'),
        ('Psychology BA', 'PsychologyBA'),
        ('Sociology BA', 'SociologyBA'),
        
        # Humanities
        ('African American Studies BA', 'AfricanAmericanStudiesBA'),
        ('American Indian Studies BA', 'AmericanIndianStudiesBA'),
        ('American Literature and Culture BA', 'AmericanLiteratureandCultureBA'),
        ('Ancient Near East and Egyptology BA', 'AncientNearEastandEgyptologyBA'),
        ('Arabic BA', 'ArabicBA'),
        ('Art History BA', 'ArtHistoryBA'),
        ('Asian American Studies BA', 'AsianAmericanStudiesBA'),
        ('Asian Humanities BA', 'AsianHumanitiesBA'),
        ('Asian Languages and Linguistics BA', 'AsianLanguagesandLinguisticsBA'),
        ('Asian Religions BA', 'AsianReligionsBA'),
        ('Asian Studies BA', 'AsianStudiesBA'),
        ('Central and East European Languages and Cultures BA', 'CentralandEastEuropeanLanguagesandCulturesBA'),
        ('Chicana and Chicano Studies BA', 'ChicanaandChicanoStudiesBA'),
        ('Chinese BA', 'ChineseBA'),
        ('Classical Civilization BA', 'ClassicalCivilizationBA'),
        ('Comparative Literature BA', 'ComparativeLiteratureBA'),
        ('Education and Social Transformation BA', 'EducationandSocialTransformationBA'),
        ('English BA', 'EnglishBA'),
        ('European Language and Transcultural Studies BA', 'EuropeanLanguageandTransculturalStudiesBA'),
        ('European Languages French and Francophone BA', 'EuropeanLanguagesFrenchBA'),
        ('European Languages German BA', 'EuropeanLanguagesGermanBA'),
        ('European Languages Italian BA', 'EuropeanLanguagesItalianBA'),
        ('European Languages Scandinavian BA', 'EuropeanLanguagesScandinavianBA'),
        ('European Studies BA', 'EuropeanStudiesBA'),
        ('Gender Studies BA', 'GenderStudiesBA'),
        ('Greek BA', 'GreekBA'),
        ('Greek and Latin BA', 'GreekandLatinBA'),
        ('History BA', 'HistoryBA'),
        ('Individual Field of Concentration BA', 'IndividualFieldofConcentrationBA'),
        ('Iranian Studies BA', 'IranianStudiesBA'),
        ('Japanese BA', 'JapaneseBA'),
        ('Jewish Studies BA', 'JewishStudiesBA'),
        ('Korean BA', 'KoreanBA'),
        ('Labor Studies BA', 'LaborStudiesBA'),
        ('Latin American Studies BA', 'LatinAmericanStudiesBA'),
        ('Latin BA', 'LatinBA'),
        ('Linguistics BA', 'LinguisticsBA'),
        ('Linguistics and Anthropology BA', 'LinguisticsandAnthropologyBA'),
        ('Linguistics and Asian Languages and Cultures BA', 'LinguisticsandAsianLanguagesandCulturesBA'),
        ('Linguistics and Computer Science BA', 'LinguisticsandComputerScienceBA'),
        ('Linguistics and English BA', 'LinguisticsandEnglishBA'),
        ('Linguistics and Philosophy BA', 'LinguisticsandPhilosophyBA'),
        ('Linguistics and Psychology BA', 'LinguisticsandPsychologyBA'),
        ('Linguistics and Spanish BA', 'LinguisticsandSpanishBA'),
        ('Linguistics Applied BA', 'LinguisticsAppliedBA'),
        ('Nordic Studies BA', 'NordicStudiesBA'),
        ('Philosophy BA', 'PhilosophyBA'),
        ('Portuguese and Brazilian Studies BA', 'PortugueseandBrazilianStudiesBA'),
        ('Religion Study of BA', 'StudyOfReligionBA'),
        ('Russian Language and Literature BA', 'RussianLanguageandLiteratureBA'),
        ('Russian Studies BA', 'RussianStudiesBA'),
        ('Southeast Asian Studies BA', 'SoutheastAsianStudiesBA'),
        ('Spanish BA', 'SpanishBA'),
        ('Spanish and Community and Culture BA', 'SpanishandCommunityandCultureBA'),
        ('Spanish and Linguistics BA', 'SpanishandLinguisticsBA'),
        ('Spanish and Portuguese BA', 'SpanishandPortugueseBA'),
        
        # Arts/Music/Film
        ('Architecture and Urban Design BA', 'ArchitectureandUrbanDesignBA'),
        ('Art BA', 'ArtBA'),
        ('Dance BFA', 'DanceBFA'),
        ('Design Media Arts BA', 'DesignMediaArtsBA'),
        ('Ethnomusicology BA', 'EthnomusicologyBA'),
        ('Film Television and Digital Media BA', 'FilmTelevisionandDigitalMediaBA'),
        ('Music BA', 'MusicBA'),
        ('Music Composition BM', 'MusicCompositionBM'),
        ('Music Education BM', 'MusicEducationBM'),
        ('Music Global Jazz Studies BA', 'MusicGlobalJazzStudiesBA'),
        ('Music Performance BM', 'MusicPerformanceBM'),
        ('Theater BA', 'TheaterBA'),
        ('World Arts and Cultures BA', 'WorldArtsandCulturesBA'),
        
        # Nursing/Public Health
        ('Nursing BS', 'NursingBS'),
        ('Public Health BS', 'PublicHealthBS'),
    ]
    
    urls = []
    for name, slug in major_slugs:
        urls.append({
            'name': name,
            'url': f'{CATALOG_BASE}/major/{CATALOG_YEAR}/{slug}'
        })
    
    print(f"  ✅ Generated {len(urls)} major URLs")
    return urls


# ═══════════════════════════════════════════════════════════════════
# STEP 2: Scrape course requirements from each major page
# ═══════════════════════════════════════════════════════════════════

def extract_course_id(course_text):
    """
    Parse a course link text like 'COM SCI 31 - Introduction to Computer Science I'
    into a course_id like 'COM SCI 31'.
    """
    # First, split on ' - ' to isolate the course code from the title
    code_part = course_text.split(' - ')[0].strip() if ' - ' in course_text else course_text.strip()
    # Remove any trailing dash
    code_part = code_part.rstrip(' -').strip()
    return code_part


def extract_subject_area(course_text):
    """
    Extract just the subject area code from a course like 'COM SCI 31 - ...'.
    
    Handles UCLA-specific patterns:
      - Regular: 'COM SCI 31' → 'COM SCI'
      - Cross-listed: 'BIOENGR C101' → 'BIOENGR'
      - Cross-listed with M: 'COM SCI M51A' → 'COM SCI'
      - Cross-listed with CM: 'EC ENGR CM16' → 'EC ENGR'
      - With ampersand: 'MECH&AE 102' → 'MECH&AE'
      - Labs: 'PHYSICS 4AL' → 'PHYSICS'
    """
    # Split on " - " to get just the course code part
    code_part = course_text.split(' - ')[0].strip() if ' - ' in course_text else course_text.strip()
    
    # Match department: all uppercase/& characters before the course number
    # Course numbers can start with digits, M (cross-listed), C (cross-listed), or CM
    match = re.match(r'^([A-Z][A-Z &]+?)(?:\s+(?:CM?\d|M?\d))', code_part)
    if match:
        return match.group(1).strip()
    
    # Fallback: split on spaces, try to find where the course number starts
    parts = code_part.split()
    for i in range(len(parts) - 1, 0, -1):
        token = parts[i]
        # Course numbers start with a digit, or M/C followed by digit
        if token and (token[0].isdigit() or 
                      (len(token) > 1 and token[0] in ('M', 'C') and token[1].isdigit()) or
                      (len(token) > 2 and token[:2] == 'CM' and token[2].isdigit())):
            return ' '.join(parts[:i])
    
    return code_part


def scrape_major_requirements(page, url, major_name):
    """Navigate to a major page and extract all required courses."""
    try:
        page.goto(url, wait_until='networkidle', timeout=30000)
        time.sleep(3)  # Extra wait for JS rendering
        
        # Extract all course links
        courses_raw = page.eval_on_selector_all(
            'a[href*="/course/"]',
            '''elements => elements.map(el => ({
                text: el.textContent.trim(),
                href: el.href
            }))'''
        )
        
        if not courses_raw:
            # Try waiting longer and retrying
            time.sleep(3)
            courses_raw = page.eval_on_selector_all(
                'a[href*="/course/"]',
                '''elements => elements.map(el => ({
                    text: el.textContent.trim(),
                    href: el.href
                }))'''
            )
        
        # Parse course data
        courses = []
        subject_areas = set()
        seen_ids = set()
        
        for c in courses_raw:
            text = c['text'].strip()
            if not text or len(text) < 3:
                continue
            
            course_id = extract_course_id(text)
            subj = extract_subject_area(text)
            
            if course_id not in seen_ids:
                seen_ids.add(course_id)
                subject_areas.add(subj)
                
                # Parse out the title
                title = ''
                if ' - ' in text:
                    title = text.split(' - ', 1)[1].strip()
                
                courses.append({
                    'course_id': course_id,
                    'subject_area': subj,
                    'title': title,
                    'catalog_url': c['href'],
                })
        
        return {
            'major_name': major_name,
            'url': url,
            'courses': courses,
            'subject_areas': sorted(list(subject_areas)),
            'num_courses': len(courses),
            'scrape_status': 'success',
        }
        
    except Exception as e:
        print(f"    ❌ Error scraping {major_name}: {e}")
        return {
            'major_name': major_name,
            'url': url,
            'courses': [],
            'subject_areas': [],
            'num_courses': 0,
            'scrape_status': f'error: {str(e)}',
        }


# ═══════════════════════════════════════════════════════════════════
# STEP 3: Save checkpoint for resuming
# ═══════════════════════════════════════════════════════════════════

def save_checkpoint(data, current_idx):
    """Save progress so scraping can be resumed."""
    checkpoint = {
        'current_idx': current_idx,
        'data': data,
    }
    with open(CHECKPOINT_FILE, 'w') as f:
        json.dump(checkpoint, f, indent=2)


def load_checkpoint():
    """Load previous checkpoint if it exists."""
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE, 'r') as f:
            return json.load(f)
    return None


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Scrape UCLA Catalog for major requirements')
    parser.add_argument('--majors-only', action='store_true',
                        help='Only discover major URLs, don\'t scrape requirements')
    parser.add_argument('--resume', action='store_true',
                        help='Resume from last checkpoint')
    parser.add_argument('--use-fallback', action='store_true',
                        help='Use pre-built major URL list instead of scraping search page')
    parser.add_argument('--max-majors', type=int, default=0,
                        help='Limit number of majors to scrape (0 = all)')
    args = parser.parse_args()
    
    # Check for resume
    results = {}
    start_idx = 0
    
    if args.resume:
        checkpoint = load_checkpoint()
        if checkpoint:
            results = {r['major_name']: r for r in checkpoint['data']}
            start_idx = checkpoint['current_idx']
            print(f"📂 Resuming from checkpoint: {start_idx} majors already scraped")
        else:
            print("⚠ No checkpoint found, starting fresh")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        )
        page = context.new_page()
        
        # Step 1: Discover major URLs
        if args.use_fallback:
            major_urls = get_fallback_major_urls()
        else:
            try:
                major_urls = discover_major_urls(page)
                if len(major_urls) < 50:
                    print("⚠ Search discovery found fewer than expected, using fallback list")
                    major_urls = get_fallback_major_urls()
            except Exception as e:
                print(f"⚠ Search discovery failed ({e}), using fallback list")
                major_urls = get_fallback_major_urls()
        
        if args.majors_only:
            print("\n📋 Major URLs discovered:")
            for i, m in enumerate(major_urls):
                print(f"  {i+1:>3}. {m['name']} → {m['url']}")
            browser.close()
            return
        
        # Step 2: Scrape each major page
        total = len(major_urls)
        if args.max_majors > 0:
            total = min(total, args.max_majors)
        
        print(f"\n🕸 Scraping course requirements for {total} majors...")
        
        for i in range(start_idx, total):
            major = major_urls[i]
            name = major['name']
            
            # Skip if already scraped (from checkpoint)
            if name in results:
                print(f"  [{i+1}/{total}] ⏭ {name} (already scraped)")
                continue
            
            print(f"  [{i+1}/{total}] 🔍 {name}...")
            result = scrape_major_requirements(page, major['url'], name)
            results[name] = result
            
            if result['num_courses'] > 0:
                print(f"           ✅ {result['num_courses']} courses, "
                      f"{len(result['subject_areas'])} departments: {result['subject_areas']}")
            else:
                print(f"           ⚠ No courses found")
            
            # Save checkpoint every 10 majors
            if (i + 1) % 10 == 0:
                save_checkpoint(list(results.values()), i + 1)
                print(f"  💾 Checkpoint saved ({i+1}/{total})")
            
            # Be polite to the server
            time.sleep(1)
        
        browser.close()
    
    # Step 3: Save final results
    output_data = {
        'metadata': {
            'catalog_year': CATALOG_YEAR,
            'scrape_date': time.strftime('%Y-%m-%d %H:%M:%S'),
            'total_majors': len(results),
            'total_majors_with_courses': sum(1 for r in results.values() if r['num_courses'] > 0),
        },
        'majors': list(results.values()),
    }
    
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output_data, f, indent=2)
    
    # Clean up checkpoint
    if os.path.exists(CHECKPOINT_FILE):
        os.remove(CHECKPOINT_FILE)
    
    # Summary
    print(f"\n{'='*60}")
    print(f"✅ SCRAPING COMPLETE")
    print(f"{'='*60}")
    print(f"  Majors scraped: {len(results)}")
    print(f"  With courses:   {sum(1 for r in results.values() if r['num_courses'] > 0)}")
    print(f"  Total courses:  {sum(r['num_courses'] for r in results.values())}")
    
    all_subjs = set()
    for r in results.values():
        all_subjs.update(r['subject_areas'])
    print(f"  Unique depts:   {len(all_subjs)}")
    print(f"  Output file:    {OUTPUT_FILE}")
    
    # Show majors with 0 courses (potential issues)
    empty = [r['major_name'] for r in results.values() if r['num_courses'] == 0]
    if empty:
        print(f"\n  ⚠ Majors with no courses found ({len(empty)}):")
        for m in empty:
            print(f"     - {m}")


if __name__ == '__main__':
    main()
