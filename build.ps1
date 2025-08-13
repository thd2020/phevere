Write-Host "Building Phevere Dictionary App..." -ForegroundColor Green

Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install

Write-Host "Building Rust native module..." -ForegroundColor Yellow
npm run build

Write-Host "Starting development server..." -ForegroundColor Yellow
npm start 