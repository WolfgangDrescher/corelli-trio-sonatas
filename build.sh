#!/bin/bash

set -Eeuo pipefail
trap 'echo "❌ ERROR: Command \"$BASH_COMMAND\" failed at line $LINENO." >&2' ERR

REPO="DCMLab/corelli"
PATH_IN_REPO="MS3"
API_URL="https://api.github.com/repos/$REPO/contents/$PATH_IN_REPO"
MSCORE="/Applications/MuseScore 4.app/Contents/MacOS/mscore"
MSCX_DIR="mscx"
MUSICXML_DIR="musicxml"
KERN_DIR="kern"

FORCE_DOWNLOAD=false
if [[ "${1-}" == "--force-download" ]]; then
	FORCE_DOWNLOAD=true
	echo "Force download: clearing all cache directories..."
	rm -rf "$MSCX_DIR" "$MUSICXML_DIR" "$KERN_DIR"
fi

mkdir -p "$MSCX_DIR"
mkdir -p "$MUSICXML_DIR"
mkdir -p "$KERN_DIR"

filter_violone() {
	if [ "${REMOVE_VIOLONE:-0}" -eq 1 ]; then
		extractxx -k 1,3,4 | shed -e 's/part4/part3/I' | shed -e 's/staff4/staff3/I' | sed "s/!!!system-decoration:.*/!!!system-decoration: [{s1,s2},s3]/g"
	else
		cat | sed "s/!!!system-decoration:.*/!!!system-decoration: [{s1,s2},s3,s4]/g"
	fi
}

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

	HUM=$(musicxml2hum "$MUSICXML_DIR/$xml_file" 2>/dev/null || echo FAILED)

	if [ "$HUM" = "FAILED" ] || [ -z "$HUM" ]; then
		REMOVE_VIOLONE=0
	else
		SPINE1=$(printf "%s" "$HUM" | extractxx -k1 | extractxx -i "**kern" | ridxx -LGTMd || echo FAILED)
		SPINE2=$(printf "%s" "$HUM" | extractxx -k2 | extractxx -i "**kern" | ridxx -LGTMd || echo FAILED)

		if [ "$SPINE1" = "FAILED" ] || [ "$SPINE2" = "FAILED" ]; then
			REMOVE_VIOLONE=0
		else
			if diff -q <(printf "%s" "$SPINE1") <(printf "%s" "$SPINE2") >/dev/null; then
				REMOVE_VIOLONE=1
			else
				REMOVE_VIOLONE=0
			fi
		fi
	fi

	printf "%s" "$HUM" \
		| grep -v '^55' \
		| grep -v "*I'" \
		| extractxx -I "**recip" \
		| extractxx -I "**mxhm" \
		| filter_violone \
		| awk -F'\t' -v OFS='\t' -v OPS="$OPS" '
{
	lines[NR]=$0
	if($1 ~ /^\*\*kern/) { kern_line=NR; split($0,kern_cols,FS) }
	if($1 ~ /^\*staff/) { staff_line=NR }
	if($1 ~ /^\*I"/) { i_line=NR }
}

END {
	kcount=0
	for(i=1;i<=length(kern_cols);i++) if(kern_cols[i] ~ /^\*\*kern/) kcount++

	keyboard_instr="Organo"
	keyboard_combined="Violone & Organo"
	if (OPS == 4) {
		keyboard_instr="Cembalo"
		keyboard_combined="Violone & Cembalo"
	}

	if (kcount==3) {
		repl[1]="*I\"" keyboard_combined
		repl[2]="*I\"Violino II"
		repl[3]="*I\"Violino I"
	} else if(kcount==4){
		repl[1]="*I\"" keyboard_instr
		repl[2]="*I\"Violone"
		repl[3]="*I\"Violino II"
		repl[4]="*I\"Violino I"
	}

	if(i_line){
		split(lines[i_line], cols, FS)
		ri=1
		for(i=1;i<=length(cols);i++){
			if(kern_cols[i] ~ /^\*\*kern/) cols[i]=repl[ri++]
			else cols[i]="*"
		}
		lines[i_line]=join(cols,OFS)
	} else if(staff_line){
		split(lines[staff_line], staff_cols, FS)
		n=length(staff_cols)
		for(i=1;i<=n;i++) new_cols[i]="*"
		ri=1
		for(i=1;i<=n;i++){
			if(kern_cols[i] ~ /^\*\*kern/) new_cols[i]=repl[ri++]
		}
		# neue Zeile direkt nach *staff einfügen
		for(i=NR;i>=staff_line+1;i--) lines[i+1]=lines[i]
		lines[staff_line+1]=join(new_cols,OFS)
		NR++
	}

	for(i=1;i<=NR;i++) print lines[i]
}

function join(a, sep,   s,i){
	s=a[1]
	for(i=2;i<=length(a);i++) s=s sep a[i]
	return s
}
' \
		| awk 'BEGIN{r=0} /OMV/ && r==0 {sub(/OMV/,"OMD"); r=1} {print}' \
		| awk -v ops="$OPS" '/^!!!OTL/ {print; print "!!!OPS: " ops; next} {print}' \
		| awk -v onm="$ONM" '/^!!!OPS/ {print; print "!!!ONM: " onm; next} {print}' \
		| awk -v omv="$OMV" '/^!!!ONM/ {print; print "!!!OMV: " omv; next} {print}' \
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
		| barnum \
		| ridxx -gild \
		| tee "$KERN_DIR/$kern_file" > /dev/null

	# Check if file is empty and exit if true
	if [[ ! -s "$KERN_DIR/$kern_file" ]]; then
		echo "❌ ERROR: $kern_file is empty. Aborting." >&2
		exit 1
	fi

	# remove if last byte is a newline
	last_byte=$(tail -c1 "$KERN_DIR/$kern_file" 2>/dev/null | od -An -t u1 | tr -d ' ')
	if [ "$last_byte" = "10" ]; then
	truncate -s -1 "$KERN_DIR/$kern_file"
fi
done

echo "Done! Humdrum files: $KERN_DIR/"

npm i
node scripts/fix-tempo.mjs
node scripts/add-modulations.mjs
node scripts/add-tempo.mjs

if [[ "$FORCE_DOWNLOAD" = true ]]; then
    node scripts/add-dcml-annotations.mjs --force-download
else
    node scripts/add-dcml-annotations.mjs
fi
