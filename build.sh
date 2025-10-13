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
		| awk -F'\t' -v OFS='\t' '
{
	for(i=1; i<=NF; i++) {
		if ($i ~ /^\*I"/) {
			indices[++count] = i
		}
	}

	lines[NR] = $0
}

END {
	# Setze *I"-Ersetzungen nach Anzahl
	if(count==3) {
		repl[1] = "*I\"Violone & Organo"
		repl[2] = "*I\"Violino II"
		repl[3] = "*I\"Violino I"
	} else if(count==4) {
		repl[1] = "*I\"Organo"
		repl[2] = "*I\"Violone"
		repl[3] = "*I\"Violino II"
		repl[4] = "*I\"Violino I"
	}

	for (i=1; i<=NR; i++) {
		split(lines[i], cols, FS)
		ri = 1
		for (j=1; j<=length(cols); j++) {
			if(cols[j] ~ /^\*I"/) {
				cols[j] = repl[ri++]
			}
		}
		print join(cols, OFS)
	}
}

function join(a, sep,   s,i) {
	s=a[1]
	for(i=2;i in a;i++) s=s sep a[i]
	return s
}
'  \
		| awk 'BEGIN{r=0} /OMV/ && r==0 {sub(/OMV/,"OMD"); r=1} {print}' \
		| awk -v ops="$OPS" '/^!!!OTL/ {print; print "!!!OPS: " ops; next} {print}' \
		| awk -v onm="$ONM" '/^!!!OPS/ {print; print "!!!ONM: " onm; next} {print}' \
		| awk -v omv="$OMV" '/^!!!ONM/ {print; print "!!!OMV: " omv; next} {print}' \
		| sed "s/!!!system-decoration:.*/!!!system-decoration: [{s1,s2},s3,s4]/g" \
		| sed "s/!!!COM:.*/!!!COM: Corelli, Arcangelo/g" \
		| sed "s/!!!OTL/!!!OPR/g" \
		| awk '
/^!!!OMD:/ {
	n = split($0, a, ":")
	if (n >= 3) {
		otl = a[2]
		omd = a[3]
		gsub(/^[ \t]+|[ \t]+$/, "", otl)
		gsub(/^[ \t]+|[ \t]+$/, "", omd)
		print "!!!OTL: " otl
		print "!!!OMD: " omd
	} else {
		val = a[2]
		gsub(/^[ \t]+|[ \t]+$/, "", val)
		print "!!!OMD: " val
	}
	next
}
{ print }
' \
		| echo -ne "$(cat)" \
		| tee "$KERN_DIR/$kern_file" > /dev/null
done

echo "Done! Humdrum files: $KERN_DIR/"
