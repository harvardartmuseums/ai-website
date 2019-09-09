# AI Explorer
> Harvard Art Museums

The AI explorer provides a front-end and a means to accessing the Harvard Museums' research on how machines interpret art by collecting data from 5 different AI services.

While the Harvard Art Museums began collecting the AI data in 2016, the data was only publicly available through the museum's API. The website began development in June 2019 and launched in August 2019. This project was built in-house and is maintained by the office of Digital Infrastructure and Emerging Technology.

## Features

* Individual object data - see all annotations from 5 different A.I. services for a particular artwork
* Search by keyword - a user-inputted keyword returns all artworks that were tagged with that word by A.I. services
* Search by category - returns all artworks sorted into 12 different broad categories by A.I. service Imagga

## Overview

The AI Explorer is an exploratory and educational website accessing the Harvard Art Museum's research data on how artificial intelligence views art. The website allows users to see how computer vision services Amazon Rekognition, Clarifai, Imagga, Google Vision, and Microsoft Cognitive Services interpret artworks in the Harvard Art Museums digital collection. Additionally, the site allows users to search by keyword in order to return artworks that were tagged by the AI services with that word.

## Requirements

* NodeJS
* Harvard Art Museums API Key ([get one here](http://www.harvardartmuseums.org/collections/api))

## Installation
To get started with this project, use the following commands:

```
# Clone the repo to your git
git clone https://github.com/harvardartmuseums/ai-website.git

# Enter the folder that was created by the clone
cd ai-site

# Install node dependencies
npm install

# Create an .env file for your Harvard Art Museums API key
touch .env

# Add your personal API key to the .env file
echo "API_KEY = 000000-00000-00000-000000-000000" >> .env

# Start the program
npm start
```

## Acknowledgements

Supported by Harvard Art Museums' office of Digital Infrastructure and Emerging Technology
Designed and developed by [Marie Konopacki](https://www.mariekonopacki.com/)
