# Gunakan Node.js versi 20
FROM node:20

# Instal dependencies sistem yang dibutuhkan untuk Sharp & Tesseract
RUN apt-get update && apt-get install -y \
    libvips-dev \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Set direktori kerja
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies (termasuk native build untuk sharp)
RUN npm install

# Copy seluruh source code
COPY . .

# Jalankan aplikasi
CMD ["npm", "start"]

COPY . .

#Port
EXPOSE 3000

CMD ["npm", "start"]
