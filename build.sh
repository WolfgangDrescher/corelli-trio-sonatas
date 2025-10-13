#!/bin/bash

REPO="DCMLab/corelli"
PATH_IN_REPO="MS3"
API_URL="https://api.github.com/repos/$REPO/contents/$PATH_IN_REPO"
MSCORE="/Applications/MuseScore 4.app/Contents/MacOS/mscore"
MSCX_DIR="mscx"
MUSICXML_DIR="musicxml"
KERN_DIR="kern"

FORCE_DOWNLOAD=false
if [[ "$1" == "--force-download" ]]; then
	FORCE_DOWNLOAD=true
	echo "Force download: clearing all cache directories..."
	rm -rf "$MSCX_DIR" "$MUSICXML_DIR" "$KERN_DIR"
fi

mkdir -p "$MSCX_DIR"
mkdir -p "$MUSICXML_DIR"
mkdir -p "$KERN_DIR"

echo "Fetching file list from $API_URL"
# Always fetch the list of MSCX files once
FILE_URLS=$(curl -s "$API_URL" | jq -r '.[] | select(.name | endswith(".mscx")) | .download_url')

for url in $FILE_URLS; do
	filename=$(basename "$url")
	xml_file="${filename%.mscx}.musicxml"
	kern_file="${filename%.mscx}.krn"

	# Download MSCX if it doesn't exist or force-download is set
	if [ ! -f "$MSCX_DIR/$filename" ] || [ "$FORCE_DOWNLOAD" = true ]; then
		echo "Downloading $filename..."
		curl -s -L -o "$MSCX_DIR/$filename" "$url"
	else
		echo "Using cached $filename"
	fi

	# Convert to MusicXML if it doesn't exist or force-download is set
	if [ ! -f "$MUSICXML_DIR/$xml_file" ] || [ "$FORCE_DOWNLOAD" = true ]; then
		echo "Converting $filename → $xml_file..."
		"$MSCORE" -o "$MUSICXML_DIR/$xml_file" "$MSCX_DIR/$filename"
	else
		echo "Using cached $xml_file"
	fi

	# Convert to Humdrum/Kern if it doesn't exist or force-download is set
	if [ ! -f "$KERN_DIR/$kern_file" ] || [ "$FORCE_DOWNLOAD" = true ]; then
		echo "Converting $xml_file → $kern_file..."

		# Add OPS and ONM based on filename
		base="${filename%.mscx}"
		OPS=$(echo "$base" | sed -E 's/op0*([0-9]+).*/\1/')
		ONM=$(echo "$base" | sed -E 's/.*n0*([0-9]+).*/\1/')
		OMV_LETTER=$(echo "$base" | sed -E 's/.*n[0-9]+([a-z]).*/\1/')
		if [ -n "$OMV_LETTER" ]; then
			OMV=$(( $(printf "%d" "'$OMV_LETTER") - 96 ))
		else
			OMV=0
		fi

		musicxml2hum "$MUSICXML_DIR/$xml_file" \
			| grep -v '^55' \
			| grep -v "*I'" \
			| extractxx -I "**recip" \
			| extractxx -I "**mxhm" \
			| awk 'BEGIN{r=0} /Keyboard/ && r==0 {sub(/Keyboard/,"Organo"); r=1} {print}' \
			| awk 'BEGIN{r=0} /StringInstrument/ && r==0 {sub(/StringInstrument/,"Violone"); r=1} {print}' \
			| awk 'BEGIN{r=0} /StringInstrument/ && r==0 {sub(/StringInstrument/,"Violino II"); r=1} {print}' \
			| awk 'BEGIN{r=0} /StringInstrument/ && r==0 {sub(/StringInstrument/,"Violino I"); r=1} {print}' \
			| awk 'BEGIN{r=0} /OMV/ && r==0 {sub(/OMV/,"OMD"); r=1} {print}' \
			| awk -v ops="$OPS" '/^!!!OTL/ {print; print "!!!OPS: " ops; next} {print}' \
			| awk -v onm="$ONM" '/^!!!OPS/ {print; print "!!!ONM: " onm; next} {print}' \
			| awk -v omv="$OMV" '/^!!!ONM/ {print; print "!!!OMV: " omv; next} {print}' \
			| sed "s/!!!system-decoration:.*/!!!system-decoration: [{s1,s2},s3,s4]/g" \
			| sed "s/!!!COM:.*/!!!COM: Corelli, Arcangelo/g" \
			| echo -ne "$(cat)" \
			| tee "$KERN_DIR/$kern_file" > /dev/null
	else
		echo "Using cached $kern_file"
	fi
done

echo "Done! Humdrum files: $KERN_DIR/"
