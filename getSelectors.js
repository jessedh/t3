
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ethers = require('ethers');

function getSelectors() {
    try {
        console.log('Running npx hardhat compile...');
        execSync('npx hardhat compile', { stdio: 'inherit' });
        console.log('Compilation successful.');
    } catch (error) {
        console.error('Error running npx hardhat compile:', error);
        return;
    }

    const artifactsDir = path.join(__dirname, 'artifacts', 'contracts', 'facets');
    const facetDirs = fs.readdirSync(artifactsDir).filter(file => file.endsWith('.sol'));

    const facetData = {};

    for (const facetDir of facetDirs) {
        const contractName = path.basename(facetDir, '.sol');
        const artifactPath = path.join(artifactsDir, facetDir, `${contractName}.json`);
        
        try {
            const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
            const abi = artifact.abi;
            if (!abi) continue;

            const selectors = [];
            for (const fragment of abi) {
                if (fragment.type === 'function') {
                    const signature = `${fragment.name}(${fragment.inputs.map(i => i.type).join(',')})`;
                    const selector = ethers.id(signature).substring(0, 10);
                    selectors.push(selector);
                }
            }
            facetData[contractName] = selectors;
        } catch (error) {
            // console.error(`Error processing ${facetDir}:`, error.message);
        }
    }

    console.log('const facetSelectors = {');
    for (const facetName in facetData) {
        console.log(`    '${facetName}': [${facetData[facetName].map(s => `'${s}'`).join(', ')}],`);
    }
    console.log('};');
}

getSelectors();
