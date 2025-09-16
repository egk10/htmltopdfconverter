import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

async function convertToPDF(htmlFile, outputFile) {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Read HTML file
    const htmlContent = fs.readFileSync(htmlFile, 'utf8');
    await page.setContent(htmlContent);
    
    // Generate PDF with minimal margins (content handles spacing)
    const pdf = await page.pdf({
        format: 'Letter',
        margin: {
            top: '5mm',
            bottom: '5mm', 
            left: '0mm',
            right: '0mm'
        },
        printBackground: true,
        preferCSSPageSize: false
    });
    
    await browser.close();
    
    // Save PDF
    fs.writeFileSync(outputFile, pdf);
    console.log(`PDF generated: ${outputFile}`);
}

// Run conversion
const htmlFile = process.argv[2] || 'apm-resume.html';
const outputFile = process.argv[3] || 'generated/apm-resume.pdf';

convertToPDF(htmlFile, outputFile).catch(console.error);